import { supabase } from "./supabaseClient.js";
import { signUp, signIn, signOut, getCurrentProfile } from "./auth.js";
import { ADMINS } from "./config.js";
import { applyLanguage } from "./i18n.js";
import {
  cacheMessages,
  getCachedMessages,
  cacheContacts,
  getCachedContacts,
  queueOutboxMessage,
  getOutbox,
  removeFromOutbox,
} from "./db.js";
import { enablePushNotifications, disablePushNotifications } from "./push.js";

const state = {
  me: null,
  t: null,
  lang: localStorage.getItem("wa_lang") || "ar",
  theme: localStorage.getItem("wa_theme") || "dark",
  contacts: [],
  contactRowsByConversation: {}, // conversationId -> DOM row (لتحديث عداد غير المقروء فوراً)
  activeConversation: null, // { id, otherProfile }
  messages: [],
  reactions: {}, // messageId -> [{id, emoji, user_id}]
  replyingTo: null,
  msgChannel: null,
  typingChannel: null,
  reactionsChannel: null,
  presenceChannel: null,
  inboxChannel: null,
  globalMsgChannel: null,
  typingTimeout: null,
  onlineMap: {},
  heartbeatInterval: null,
  recording: null, // { mediaRecorder, chunks, stream, seconds, timerInterval }
  isOnline: navigator.onLine,
  clickedWelcomeButtons: new Set(), // معرفات الرسائل التي ضُغط أحد أزرارها بالفعل (لتعطيلها بصرياً بعد الاستخدام)
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------
async function boot() {
  document.body.setAttribute("data-theme", state.theme);

  await loadChatPanelPartial();
  state.t = applyLanguage(state.lang); // بعد حقن الجزء الديناميكي حتى تُطبَّق data-i18n عليه أيضاً

  // ---------------- Auto-Login / Persistent Auth ----------------
  // نتحقق من الجلسة المخزّنة (localStorage) قبل إظهار أي واجهة؛ شاشة boot-loading
  // تبقى ظاهرة طوال هذا الفحص حتى لا تومض شاشة تسجيل الدخول لمستخدم لديه جلسة نشطة أصلاً.
  const { data: { session } } = await supabase.auth.getSession();
  wireAuthForms();
  wireChrome();

  $("#boot-loading")?.classList.add("hidden");
  if (session) {
    await enterApp(); // ينتقل المستخدم فوراً لواجهة المحادثات دون المرور بشاشة الدخول
  } else {
    showAuthScreen();
  }

  // يتعامل مع انتهاء صلاحية الجلسة أو تسجيل الخروج من جهاز/تبويب آخر أثناء الاستخدام
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      state.me = null;
      showAuthScreen();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (state.me) {
      navigator.sendBeacon &&
        navigator.sendBeacon(
          "about:blank" // no-op fallback; real update happens in visibilitychange below when supported
        );
    }
  });
  document.addEventListener("visibilitychange", async () => {
    if (!state.me) return;
    if (document.visibilityState === "hidden") {
      await touchLastSeen(false);
    } else {
      await touchLastSeen(true);
      resubscribeRealtime();
    }
  });

  window.addEventListener("online", () => {
    state.isOnline = true;
    updateOfflineBanner();
    flushOutbox();
    resubscribeRealtime();
  });
  window.addEventListener("offline", () => {
    state.isOnline = false;
    updateOfflineBanner();
  });
  updateOfflineBanner();

  // ---------------- SPA Router: زر الرجوع الفعلي للجهاز/المتصفح ----------------
  window.addEventListener("popstate", (event) => {
    if (!event.state || !event.state.waChat) {
      closeChatView();
    }
  });
  // Event Delegation: يعمل حتى لو أُعيد حقن partials/chat-panel.html لاحقاً
  document.addEventListener("click", (e) => {
    if (e.target.closest("#back-to-list")) {
      if (history.state && history.state.waChat) {
        history.back();
      } else {
        closeChatView();
      }
    }
  });
}

// إعادة الاشتراك في كل قنوات Realtime بعد انقطاع الاتصال أو عودة ظهور الصفحة
function resubscribeRealtime() {
  if (!state.me) return;

  if (state.presenceChannel) supabase.removeChannel(state.presenceChannel);
  subscribeGlobalPresence();

  if (state.inboxChannel) supabase.removeChannel(state.inboxChannel);
  subscribeInboxUpdates();

  if (state.globalMsgChannel) supabase.removeChannel(state.globalMsgChannel);
  subscribeGlobalMessageWatch();

  if (state.activeConversation) {
    subscribeToConversation(state.activeConversation.id);
    loadMessages(state.activeConversation.id);
  }
}

// ---------------- التنقل بين قائمة المحادثات وشاشة الدردشة (Mobile/Tablet) ----------------
function openConversationUIState(conversationId) {
  document.body.classList.add("viewing-chat");
  if (history.state && history.state.waChat) {
    history.replaceState({ waChat: true, conversationId }, "", "#chat");
  } else {
    history.pushState({ waChat: true, conversationId }, "", "#chat");
  }
}

function closeChatView() {
  document.body.classList.remove("viewing-chat");
  // توافق خلفي مع الأصناف القديمة
  $("#chat-panel")?.classList.remove("mobile-visible");
  $("#sidebar")?.classList.remove("mobile-hidden");
}

function updateOfflineBanner() {
  const banner = $("#offline-banner");
  if (!banner) return;
  banner.classList.toggle("hidden", state.isOnline);
}

// تحميل واجهة المحادثة كملف HTML منفصل وحقنها في الصفحة
async function loadChatPanelPartial() {
  const res = await fetch("./partials/chat-panel.html");
  const html = await res.text();
  $("#chat-panel-container").innerHTML = html;
}

function showAuthScreen() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

async function enterApp() {
  state.me = await getCurrentProfile();
  if (!state.me) {
    showAuthScreen();
    return;
  }
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#my-name").textContent = state.me.display_name;
  if (state.me.avatar_url) $("#my-avatar").src = state.me.avatar_url;
  applyThemeVars();

  await touchLastSeen(true);
  startHeartbeat();

  await loadContacts();
  subscribeGlobalPresence();
  subscribeInboxUpdates();
  subscribeGlobalMessageWatch();
  if (state.isOnline) flushOutbox();
}

async function touchLastSeen(online) {
  if (!state.me) return;
  await supabase
    .from("profiles")
    .update({ is_online: online, last_seen: new Date().toISOString() })
    .eq("id", state.me.id);
}

function startHeartbeat() {
  clearInterval(state.heartbeatInterval);
  state.heartbeatInterval = setInterval(() => {
    if (document.visibilityState === "visible") touchLastSeen(true);
  }, 25000);
}

// ---------------------------------------------------------------
// AUTH FORMS
// ---------------------------------------------------------------
function wireAuthForms() {
  $("#tab-login").addEventListener("click", () => switchAuthTab("login"));
  $("#tab-signup").addEventListener("click", () => switchAuthTab("signup"));

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    try {
      await signIn({ email, password });
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#signup-email").value.trim();
    const password = $("#signup-password").value;
    const displayName = $("#signup-name").value.trim();
    const phone = $("#signup-phone").value.trim();
    try {
      await signUp({ email, password, displayName, phone });
      await signIn({ email, password });
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    }
  });
}

function switchAuthTab(which) {
  $("#tab-login").classList.toggle("active", which === "login");
  $("#tab-signup").classList.toggle("active", which === "signup");
  $("#login-form").classList.toggle("hidden", which !== "login");
  $("#signup-form").classList.toggle("hidden", which !== "signup");
}

function showAuthError(msg) {
  const text = msg || state.t?.error_generic || "حدث خطأ ما";
  // إن كانت شاشة الدخول ظاهرة، اعرض الخطأ فيها؛ وإلا استخدم Toast عام يظهر فوق أي واجهة
  const authScreenVisible = !$("#auth-screen").classList.contains("hidden");
  if (authScreenVisible) {
    const el = $("#auth-error");
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
  } else {
    const toast = $("#global-toast");
    toast.textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(() => toast.classList.add("hidden"), 5000);
  }
}

// ---------------------------------------------------------------
// CHROME
// ---------------------------------------------------------------
function wireChrome() {
  $("#btn-settings").addEventListener("click", () => $("#settings-panel").classList.toggle("hidden"));
  $("#btn-logout").addEventListener("click", async () => {
    await signOut(state.me?.id);
    location.reload();
  });

  $("#lang-toggle").addEventListener("click", toggleLanguage);
  $("#theme-toggle").addEventListener("click", toggleTheme);
  // نفس زري اللغة/المظهر لكن في شاشة الدخول قبل تسجيل الدخول
  $("#auth-lang-toggle")?.addEventListener("click", toggleLanguage);
  $("#auth-theme-toggle")?.addEventListener("click", toggleTheme);

  $("#avatar-input").addEventListener("change", handleAvatarUpload);
  $("#wallpaper-input").addEventListener("change", handleWallpaperUpload);
  $("#btn-enable-push").addEventListener("click", async () => {
    const ok = await enablePushNotifications(state.me.id);
    showAuthError(ok ? "تم تفعيل الإشعارات ✅" : "تعذّر التفعيل — تحقق من إذن المتصفح أو مفتاح VAPID");
  });

  wireChatPanel();
  wireEmojiPicker();
}

function toggleLanguage() {
  state.lang = state.lang === "ar" ? "en" : "ar";
  localStorage.setItem("wa_lang", state.lang);
  state.t = applyLanguage(state.lang);
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("wa_theme", state.theme);
  document.body.setAttribute("data-theme", state.theme);
  applyThemeVars();
}

// كل ما يخص لوحة المحادثة (تُحقن ديناميكياً، لذلك نربطها بعد loadChatPanelPartial)
function wireChatPanel() {
  $("#composer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#composer-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await sendMessage({ content: text });
  });

  $("#composer-input").addEventListener("input", handleTypingInput);
  $("#attach-input").addEventListener("change", handleAttachmentUpload);

  // ملاحظة: زر back-to-list يُربط عبر Event Delegation في boot() وليس هنا،
  // ليعمل بشكل موثوق حتى لو أُعيد حقن partials/chat-panel.html لاحقاً.

  $("#reply-preview-cancel").addEventListener("click", clearReply);

  $("#mic-btn").addEventListener("click", toggleRecording);
  $("#recording-cancel").addEventListener("click", cancelRecording);
}

function applyThemeVars() {
  if (state.me?.wallpaper_url) {
    $("#chat-messages").style.backgroundImage = `url(${state.me.wallpaper_url})`;
  }
}

// ---------------------------------------------------------------
// CONTACTS / ROLE ROUTING
// ---------------------------------------------------------------
async function loadContacts() {
  if (!state.isOnline) {
    const cached = await getCachedContacts();
    renderContactsFromCache(cached);
    return;
  }
  try {
    await loadContactsFromNetwork();
  } catch (err) {
    const cached = await getCachedContacts();
    renderContactsFromCache(cached);
  }
}

function renderContactsFromCache(cached) {
  state.contactRowsByConversation = {};
  $("#contact-list").innerHTML = "";
  $("#admins-heading").classList.add("hidden");
  $("#admins-section").classList.add("hidden");
  $("#users-heading").classList.add("hidden");
  $("#users-section").classList.add("hidden");
  cached.forEach((c) => $("#contact-list").appendChild(buildContactRow(c, { withUnread: !!c._unread })));
}

async function loadContactsFromNetwork() {
  state.contactRowsByConversation = {};
  if (!state.me.is_admin) {
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("*")
      .in("email", ADMINS.map((a) => a.email));
    state.contacts = adminProfiles || [];
    $("#contact-list").innerHTML = "";
    $("#admins-heading").classList.add("hidden");
    $("#admins-section").classList.add("hidden");
    $("#users-heading").classList.add("hidden");
    $("#users-section").classList.add("hidden");
    state.contacts.forEach((c) => $("#contact-list").appendChild(buildContactRow(c, { withUnread: false })));
    await cacheContacts(state.contacts);
  } else {
    $("#contact-list").innerHTML = "";
    $("#admins-heading").classList.remove("hidden");
    $("#admins-section").classList.remove("hidden");
    $("#users-heading").classList.remove("hidden");
    $("#users-section").classList.remove("hidden");

    const { data: otherAdmins } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_admin", true)
      .neq("id", state.me.id);

    const { data: convs } = await supabase
      .from("conversations")
      .select("*, user:profiles!conversations_user_id_fkey(*)")
      .eq("admin_id", state.me.id)
      .order("last_message_at", { ascending: false });

    const userContacts = [];
    for (const c of convs || []) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", c.id)
        .neq("sender_id", state.me.id)
        .neq("status", "read");
      userContacts.push({ ...c.user, _conversationId: c.id, _unread: count || 0, _lastMessage: c.last_message });
    }

    $("#admins-section").innerHTML = "";
    (otherAdmins || []).forEach((c) => $("#admins-section").appendChild(buildContactRow(c, { withUnread: false })));
    $("#users-section").innerHTML = "";
    userContacts.forEach((c) => $("#users-section").appendChild(buildContactRow(c, { withUnread: true })));
    await cacheContacts([...(otherAdmins || []), ...userContacts]);
  }
}

function buildContactRow(c, opts) {
  const row = document.createElement("div");
  row.className = "contact-row";
  const initials = (c.display_name || "?").trim().charAt(0);
  const online = c.id && state.onlineMap[c.id];
  row.innerHTML = `
    <div class="avatar">${c.avatar_url ? `<img src="${c.avatar_url}">` : initials}
      ${online ? '<span class="dot-online"></span>' : ""}</div>
    <div class="contact-info">
      <div class="contact-name">${escapeHtml(c.display_name)}</div>
      <div class="contact-sub">${escapeHtml(c._lastMessage || "")}</div>
    </div>
    ${opts.withUnread && c._unread ? `<div class="unread-badge">${c._unread}</div>` : ""}
  `;
  row.addEventListener("click", () => openConversation(c));

  if (opts.withUnread && c._conversationId) {
    row.dataset.conversationId = c._conversationId;
    row.dataset.unread = String(c._unread || 0);
    state.contactRowsByConversation[c._conversationId] = row;
  }

  return row;
}

// تُستدعى من قناة Realtime عامة لتحديث شارة "غير مقروء" فوراً دون إعادة تحميل كامل القائمة
function bumpUnreadBadge(conversationId) {
  const row = state.contactRowsByConversation[conversationId];
  if (!row) {
    // محادثة جديدة لم تُعرض بعد في القائمة — أعد تحميلها كاملة لإظهارها
    loadContacts();
    return;
  }
  const current = parseInt(row.dataset.unread || "0", 10) + 1;
  row.dataset.unread = String(current);
  let badge = row.querySelector(".unread-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "unread-badge";
    row.appendChild(badge);
  }
  badge.textContent = String(current);
}

function clearUnreadBadge(conversationId) {
  const row = state.contactRowsByConversation[conversationId];
  if (!row) return;
  row.dataset.unread = "0";
  row.querySelector(".unread-badge")?.remove();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ---------------------------------------------------------------
// CONVERSATION
// ---------------------------------------------------------------
async function openConversation(otherProfile) {
  if (!otherProfile.id) {
    // هذا يحدث عندما يكون المشرف ضمن القائمة الثابتة في config.js لكنه لم يُنشئ
    // حسابه بعد (لا يوجد صف مطابق في جدول profiles) — لذلك لا يوجد id لنبدأ به محادثة معه.
    showAuthError("هذا المشرف لم يُنشئ حسابه في التطبيق بعد، لا يمكن بدء محادثة معه حالياً.");
    return;
  }

  try {
    $("#chat-empty-state").classList.add("hidden");
    $("#chat-active").classList.remove("hidden");
    clearReply();

    let conversationId = otherProfile._conversationId;
    if (!conversationId) {
      const userId = state.me.is_admin ? otherProfile.id : state.me.id;
      const adminId = state.me.is_admin ? state.me.id : otherProfile.id;
      const { data: existing, error: selectErr } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .eq("admin_id", adminId)
        .maybeSingle();
      if (selectErr) throw selectErr;

      if (existing) {
        conversationId = existing.id;
      } else {
        const { data: created, error } = await supabase
          .from("conversations")
          .insert({ user_id: userId, admin_id: adminId })
          .select()
          .single();
        if (error) throw error;
        conversationId = created.id;
      }
    }

    state.activeConversation = { id: conversationId, otherProfile };
    openConversationUIState(conversationId);
    $("#chat-header-name").textContent = otherProfile.display_name;
    $("#chat-header-avatar").src = otherProfile.avatar_url || "";
    await refreshPresenceLabel(otherProfile.id);

    await loadMessages(conversationId);
    await loadReactionsForConversation();
    subscribeToConversation(conversationId);
    await markConversationRead(conversationId);
    clearUnreadBadge(conversationId);
  } catch (err) {
    console.error("openConversation failed:", err);
    showAuthError(
      "تعذّر فتح المحادثة: " + (err?.message || "خطأ غير معروف") +
      " — تأكد من تشغيل sql/schema.sql بالكامل ومن صحة SUPABASE_URL/ANON_KEY في js/config.js"
    );
    // أعد عرض قائمة المحادثات في حال الفشل حتى لا تبقى الواجهة عالقة
    closeChatView();
  }
}

async function loadMessages(conversationId) {
  // اعرض النسخة المخزّنة محلياً فوراً (سريعة، وتعمل دون اتصال)
  const cached = await getCachedMessages(conversationId);
  if (cached.length) {
    state.messages = cached;
    renderMessages();
  }

  if (!state.isOnline) return; // ابقَ على النسخة المحلية إن لم يوجد اتصال

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return; // فشل الشبكة رغم navigator.onLine — النسخة المحلية تبقى ظاهرة

  state.messages = data || [];
  renderMessages();
  await cacheMessages(conversationId, state.messages);
}

async function loadReactionsForConversation() {
  state.reactions = {};
  const ids = state.messages.map((m) => m.id);
  if (!ids.length) return;
  const { data } = await supabase.from("message_reactions").select("*").in("message_id", ids);
  (data || []).forEach((r) => {
    if (!state.reactions[r.message_id]) state.reactions[r.message_id] = [];
    state.reactions[r.message_id].push(r);
  });
  renderMessages();
}

function renderMessages() {
  const box = $("#chat-messages");
  box.innerHTML = "";
  if (!state.messages.length) {
    box.innerHTML = `<div class="empty-chat">${state.t.no_messages}</div>`;
    return;
  }
  state.messages.forEach((m) => box.appendChild(buildMessageBubble(m)));
  box.scrollTop = box.scrollHeight;
}

function findMessageById(id) {
  return state.messages.find((m) => m.id === id);
}

function messagePreviewText(m) {
  if (!m) return "";
  if (m.content) return m.content;
  if (m.attachment_type === "image") return "📷 صورة";
  if (m.attachment_type === "audio") return "🎤 رسالة صوتية";
  if (m.attachment_type === "file") return "📎 ملف";
  return "";
}

function buildMessageBubble(m) {
  const mine = m.sender_id === state.me.id;
  const div = document.createElement("div");
  div.className = `bubble-row ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = m.id;

  const time = new Date(m.created_at).toLocaleTimeString(state.lang === "ar" ? "ar-SA" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const ticks = mine ? (m._pending ? '<span class="ticks">🕓</span>' : renderTicks(m.status)) : "";

  const quoted = m.reply_to_id ? findMessageById(m.reply_to_id) : null;
  const quotedHtml = quoted
    ? `<div class="quoted-reply">${escapeHtml(messagePreviewText(quoted))}</div>`
    : "";

  let attach = "";
  if (m.attachment_url) {
    if (m.attachment_type === "image") {
      attach = `<img class="msg-attachment" src="${m.attachment_url}">`;
    } else if (m.attachment_type === "audio") {
      attach = `<audio class="msg-audio" controls src="${m.attachment_url}"></audio>`;
    } else {
      attach = `<a class="msg-file" href="${m.attachment_url}" target="_blank">📎 ${state.t.attach}</a>`;
    }
  }

  const reactions = state.reactions[m.id] || [];
  const grouped = {};
  reactions.forEach((r) => {
    grouped[r.emoji] = grouped[r.emoji] || { count: 0, mine: false };
    grouped[r.emoji].count += 1;
    if (r.user_id === state.me.id) grouped[r.emoji].mine = true;
  });
  const reactionsHtml = Object.keys(grouped).length
    ? `<div class="reaction-bar">${Object.entries(grouped)
        .map(
          ([emoji, g]) =>
            `<span class="reaction-chip ${g.mine ? "mine" : ""}" data-emoji="${emoji}">${emoji} ${g.count}</span>`
        )
        .join("")}</div>`
    : "";

  // أزرار تفاعلية (رسالة ترحيبية من البوت) — تُعرض فقط لمستقبل الرسالة، وليس لمن أرسلها
  let buttonsHtml = "";
  if (!mine && Array.isArray(m.buttons) && m.buttons.length) {
    const used = state.clickedWelcomeButtons.has(m.id);
    buttonsHtml = `<div class="msg-buttons">${m.buttons
      .map(
        (b) =>
          `<button type="button" class="msg-btn" data-value="${escapeHtml(b.value)}" ${used ? "disabled" : ""}>${escapeHtml(b.label)}</button>`
      )
      .join("")}</div>`;
  }

  div.innerHTML = `
    <div class="bubble">
      <div class="bubble-actions">
        <button class="bubble-action-reply" title="${state.t.reply}">↩</button>
        <button class="bubble-action-react" title="React">😊</button>
      </div>
      ${quotedHtml}
      ${attach}
      ${m.content ? `<div class="bubble-text">${escapeHtml(m.content)}</div>` : ""}
      <div class="bubble-meta"><span class="bubble-time">${time}</span>${ticks}</div>
      ${reactionsHtml}
      ${buttonsHtml}
      <div class="quick-react-panel hidden"></div>
    </div>`;

  // معالجة الضغط على أزرار الرسالة التفاعلية: يُرسل نص الزر كرسالة عادية من العميل،
  // ثم يتولى بوت الكلمات المفتاحية على مستوى قاعدة البيانات (trigger) توليد الرد التلقائي تلقائياً
  div.querySelectorAll(".msg-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      state.clickedWelcomeButtons.add(m.id);
      div.querySelectorAll(".msg-btn").forEach((b) => (b.disabled = true));
      await sendMessage({ content: btn.dataset.value });
    });
  });

  div.querySelector(".bubble-action-reply").addEventListener("click", () => setReplyTarget(m));
  const reactBtn = div.querySelector(".bubble-action-react");
  const quickPanel = div.querySelector(".quick-react-panel");
  const quickEmojis = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
  quickPanel.innerHTML = quickEmojis
    .map((e) => `<span class="quick-react-opt" data-emoji="${e}">${e}</span>`)
    .join("");
  reactBtn.addEventListener("click", () => quickPanel.classList.toggle("hidden"));
  quickPanel.addEventListener("click", (e) => {
    const emoji = e.target.dataset.emoji;
    if (emoji) {
      toggleReaction(m.id, emoji);
      quickPanel.classList.add("hidden");
    }
  });
  div.querySelectorAll(".reaction-chip").forEach((chip) => {
    chip.addEventListener("click", () => toggleReaction(m.id, chip.dataset.emoji));
  });

  wireSwipeToReply(div, m);

  return div;
}

// ---------------------------------------------------------------
// SWIPE TO REPLY (touch devices)
// ---------------------------------------------------------------
function wireSwipeToReply(row, message) {
  const bubble = row.querySelector(".bubble");
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let horizontalLock = false;
  const THRESHOLD = 60;

  row.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    dragging = true;
    horizontalLock = false;
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    if (!horizontalLock) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        horizontalLock = Math.abs(deltaX) > Math.abs(deltaY);
      }
      if (!horizontalLock) return;
    }

    e.preventDefault(); // امنع تمرير الصفحة رأسياً أثناء السحب الأفقي
    dx = Math.max(-90, Math.min(90, deltaX));
    bubble.style.transform = `translateX(${dx}px)`;
    bubble.style.transition = "none";
    row.classList.toggle("swipe-armed", Math.abs(dx) > THRESHOLD);
  }, { passive: false });

  row.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    bubble.style.transition = "transform .2s ease";
    bubble.style.transform = "translateX(0)";
    row.classList.remove("swipe-armed");
    if (horizontalLock && Math.abs(dx) > THRESHOLD) {
      setReplyTarget(message);
      if (navigator.vibrate) navigator.vibrate(15);
    }
    dx = 0;
  });
}

function renderTicks(status) {
  if (status === "read") return '<span class="ticks ticks-read">✓✓</span>';
  if (status === "delivered") return '<span class="ticks">✓✓</span>';
  return '<span class="ticks">✓</span>';
}

// ---------------------------------------------------------------
// REPLY
// ---------------------------------------------------------------
function setReplyTarget(m) {
  state.replyingTo = m;
  $("#reply-preview-text").textContent = messagePreviewText(m);
  $("#reply-preview-bar").classList.remove("hidden");
  $("#composer-input").focus();
}

function clearReply() {
  state.replyingTo = null;
  $("#reply-preview-bar")?.classList.add("hidden");
}

// ---------------------------------------------------------------
// REACTIONS
// ---------------------------------------------------------------
async function toggleReaction(messageId, emoji) {
  const existing = (state.reactions[messageId] || []).find(
    (r) => r.user_id === state.me.id && r.emoji === emoji
  );
  if (existing) {
    await supabase.from("message_reactions").delete().eq("id", existing.id);
  } else {
    await supabase.from("message_reactions").insert({
      message_id: messageId,
      user_id: state.me.id,
      emoji,
    });
  }
  await loadReactionsForConversation();
}

// ---------------------------------------------------------------
// SEND MESSAGE / ATTACHMENTS
// ---------------------------------------------------------------
async function sendMessage({ content, attachmentUrl, attachmentType }) {
  const conv = state.activeConversation;
  if (!conv) return;
  const replyToId = state.replyingTo?.id || null;

  if (!state.isOnline) {
    // لا يوجد اتصال: خزّن الرسالة محلياً في outbox واعرضها فوراً بحالة "قيد الإرسال"
    const optimistic = {
      id: `local-${Date.now()}`,
      conversation_id: conv.id,
      sender_id: state.me.id,
      content: content || null,
      attachment_url: attachmentUrl || null,
      attachment_type: attachmentType || null,
      reply_to_id: replyToId,
      status: "pending",
      created_at: new Date().toISOString(),
      _pending: true,
    };
    state.messages.push(optimistic);
    renderMessages();
    await queueOutboxMessage({
      conversation_id: conv.id,
      sender_id: state.me.id,
      content: content || null,
      attachment_url: attachmentUrl || null,
      attachment_type: attachmentType || null,
      reply_to_id: replyToId,
    });
    clearReply();
    return;
  }

  const { error } = await supabase.from("messages").insert({
    conversation_id: conv.id,
    sender_id: state.me.id,
    content: content || null,
    attachment_url: attachmentUrl || null,
    attachment_type: attachmentType || null,
    reply_to_id: replyToId,
    status: "sent",
  });
  if (error) { showAuthError(error.message); return; }

  await supabase
    .from("conversations")
    .update({ last_message: content || messagePreviewText({ attachment_type: attachmentType }), last_message_at: new Date().toISOString() })
    .eq("id", conv.id);

  clearReply();
  await setTyping(false);
}

// يُنفَّذ عند عودة الاتصال: يرسل كل الرسائل المؤجلة في outbox بالترتيب
async function flushOutbox() {
  const pending = await getOutbox();
  if (!pending.length) return;
  for (const item of pending) {
    const { local_id, queued_at, ...msg } = item;
    const { error } = await supabase.from("messages").insert({ ...msg, status: "sent" });
    if (!error) {
      await removeFromOutbox(local_id);
      await supabase
        .from("conversations")
        .update({ last_message: msg.content || messagePreviewText({ attachment_type: msg.attachment_type }), last_message_at: new Date().toISOString() })
        .eq("id", msg.conversation_id);
    }
  }
  // نظّف الفقاعات المؤقتة المعلّقة وأعد تحميل المحادثة الحالية من الخادم
  if (state.activeConversation) {
    state.messages = state.messages.filter((m) => !m._pending);
    await loadMessages(state.activeConversation.id);
  }
}

async function handleAttachmentUpload(e) {
  const file = e.target.files[0];
  if (!file || !state.activeConversation) return;
  const path = `${state.me.id}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file);
  if (error) { showAuthError(error.message); return; }
  const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
  const type = file.type.startsWith("image/") ? "image" : "file";
  await sendMessage({ content: null, attachmentUrl: pub.publicUrl, attachmentType: type });
  e.target.value = "";
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const path = `${state.me.id}/avatar_${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) { showAuthError(error.message); return; }
  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  await supabase.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", state.me.id);
  state.me.avatar_url = pub.publicUrl;
  $("#my-avatar").src = pub.publicUrl;
}

async function handleWallpaperUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const path = `${state.me.id}/wall_${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("wallpapers").upload(path, file, { upsert: true });
  if (error) { showAuthError(error.message); return; }
  const { data: pub } = supabase.storage.from("wallpapers").getPublicUrl(path);
  await supabase.from("profiles").update({ wallpaper_url: pub.publicUrl }).eq("id", state.me.id);
  state.me.wallpaper_url = pub.publicUrl;
  applyThemeVars();
}

// ---------------------------------------------------------------
// VOICE RECORDING (MIC)
// ---------------------------------------------------------------
async function toggleRecording() {
  if (state.recording) {
    await stopAndSendRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  if (!state.activeConversation) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showAuthError("التسجيل الصوتي غير مدعوم في هذا المتصفح");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.start();

    state.recording = { mediaRecorder, chunks, stream, seconds: 0, timerInterval: null };
    $("#recording-bar").classList.remove("hidden");
    $("#composer-input").classList.add("hidden");
    $("#mic-btn").textContent = "⏹";
    $("#mic-btn").classList.add("recording-active");

    state.recording.timerInterval = setInterval(() => {
      state.recording.seconds += 1;
      const mm = String(Math.floor(state.recording.seconds / 60)).padStart(2, "0");
      const ss = String(state.recording.seconds % 60).padStart(2, "0");
      $("#recording-timer").textContent = `${mm}:${ss}`;
    }, 1000);
  } catch (err) {
    showAuthError("لم يتم منح إذن الوصول للميكروفون");
  }
}

async function stopAndSendRecording() {
  const rec = state.recording;
  if (!rec) return;
  const blob = await finalizeRecording(rec);
  resetRecordingUI();
  if (!blob) return;

  const path = `${state.me.id}/voice_${Date.now()}.webm`;
  const { error } = await supabase.storage.from("attachments").upload(path, blob, {
    contentType: "audio/webm",
  });
  if (error) { showAuthError(error.message); return; }
  const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
  await sendMessage({ content: null, attachmentUrl: pub.publicUrl, attachmentType: "audio" });
}

function cancelRecording() {
  const rec = state.recording;
  if (!rec) return;
  finalizeRecording(rec, true);
  resetRecordingUI();
}

function finalizeRecording(rec, discard) {
  return new Promise((resolve) => {
    clearInterval(rec.timerInterval);
    rec.mediaRecorder.onstop = () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      if (discard) return resolve(null);
      resolve(new Blob(rec.chunks, { type: "audio/webm" }));
    };
    if (rec.mediaRecorder.state !== "inactive") rec.mediaRecorder.stop();
    else resolve(null);
  });
}

function resetRecordingUI() {
  state.recording = null;
  $("#recording-bar").classList.add("hidden");
  $("#recording-timer").textContent = "00:00";
  $("#composer-input").classList.remove("hidden");
  $("#mic-btn").textContent = "🎤";
  $("#mic-btn").classList.remove("recording-active");
}

// ---------------------------------------------------------------
// REALTIME
// ---------------------------------------------------------------
function subscribeToConversation(conversationId) {
  if (state.msgChannel) supabase.removeChannel(state.msgChannel);
  if (state.typingChannel) supabase.removeChannel(state.typingChannel);
  if (state.reactionsChannel) supabase.removeChannel(state.reactionsChannel);

  state.msgChannel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      async (payload) => {
        state.messages.push(payload.new);
        renderMessages();
        cacheMessages(conversationId, [payload.new]);
        if (payload.new.sender_id !== state.me.id) {
          playNotificationSound();
          await markConversationRead(conversationId);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const idx = state.messages.findIndex((m) => m.id === payload.new.id);
        if (idx > -1) state.messages[idx] = payload.new;
        renderMessages();
      }
    )
    .subscribe();

  state.typingChannel = supabase
    .channel(`typing:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "typing_status", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new;
        if (row && row.user_id !== state.me.id) {
          $("#typing-indicator").classList.toggle("hidden", !row.is_typing);
        }
      }
    )
    .subscribe();

  // إعادة تحميل التفاعلات عند أي تغيير (بدون فلترة لأن الجدول لا يحوي conversation_id)
  state.reactionsChannel = supabase
    .channel(`reactions:${conversationId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
      const row = payload.new || payload.old;
      if (row && state.messages.some((m) => m.id === row.message_id)) {
        loadReactionsForConversation();
      }
    })
    .subscribe();
}

async function markConversationRead(conversationId) {
  await supabase
    .from("messages")
    .update({ status: "read" })
    .eq("conversation_id", conversationId)
    .neq("sender_id", state.me.id)
    .neq("status", "read");
}

function handleTypingInput() {
  setTyping(true);
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => setTyping(false), 2000);
}

async function setTyping(isTyping) {
  const conv = state.activeConversation;
  if (!conv) return;
  await supabase.from("typing_status").upsert(
    {
      conversation_id: conv.id,
      user_id: state.me.id,
      is_typing: isTyping,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id,user_id" }
  );
}

function subscribeGlobalPresence() {
  state.presenceChannel = supabase.channel("presence:global", {
    config: { presence: { key: state.me.id } },
  });

  state.presenceChannel
    .on("presence", { event: "sync" }, () => {
      const presState = state.presenceChannel.presenceState();
      state.onlineMap = {};
      Object.keys(presState).forEach((id) => (state.onlineMap[id] = true));
      loadContacts();
      if (state.activeConversation) refreshPresenceLabel(state.activeConversation.otherProfile.id);
    })
    .on("presence", { event: "leave" }, async ({ leftPresences }) => {
      // عندما يغادر أحدهم، حدّث "آخر ظهور" فور حدوث ذلك محلياً لعرضها فوراً
      if (state.activeConversation) {
        const leftIds = leftPresences.map((p) => p.presence_ref && p.key).filter(Boolean);
        if (leftIds.includes(state.activeConversation.otherProfile.id)) {
          await refreshPresenceLabel(state.activeConversation.otherProfile.id);
        }
      }
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await state.presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}

async function refreshPresenceLabel(otherId) {
  const label = $("#chat-header-status");
  if (state.onlineMap[otherId]) {
    label.textContent = state.t.online;
    return;
  }
  const { data: profile } = await supabase.from("profiles").select("last_seen").eq("id", otherId).single();
  if (profile?.last_seen) {
    const d = new Date(profile.last_seen);
    const time = d.toLocaleTimeString(state.lang === "ar" ? "ar-SA" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const dateLabel = d.toDateString() === new Date().toDateString()
      ? time
      : d.toLocaleDateString(state.lang === "ar" ? "ar-SA" : "en-US") + " " + time;
    label.textContent = `${state.t.last_seen} ${dateLabel}`;
  } else {
    label.textContent = "";
  }
}

function subscribeInboxUpdates() {
  state.inboxChannel = supabase
    .channel("inbox-updates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      (payload) => {
        const row = payload.new;
        if (row && (row.user_id === state.me.id || row.admin_id === state.me.id)) {
          loadContacts();
        }
      }
    )
    .subscribe();
}

// قناة عامة: تُحدّث شارة الرسائل غير المقروءة فوراً عند وصول أي رسالة جديدة (للمشرف فقط)
function subscribeGlobalMessageWatch() {
  if (!state.me?.is_admin) return;
  state.globalMsgChannel = supabase
    .channel("global-messages-watch")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        if (msg.sender_id === state.me.id) return;
        // إن كانت هذه المحادثة مفتوحة حالياً، ستُعلَّم كمقروءة عبر قناة subscribeToConversation نفسها
        if (state.activeConversation && msg.conversation_id === state.activeConversation.id) return;
        bumpUnreadBadge(msg.conversation_id);
      }
    )
    .subscribe();
}

function playNotificationSound() {
  const audio = $("#notification-sound");
  audio?.play().catch(() => {});
}

// ---------------------------------------------------------------
// EMOJI PICKER (composer)
// ---------------------------------------------------------------
function wireEmojiPicker() {
  const btn = $("#emoji-toggle");
  const panel = $("#emoji-panel");
  if (!btn || !panel) return;
  if (panel.dataset.wired === "1") return; // يمنع الربط المكرر إن استُدعيت الدالة أكثر من مرة
  panel.dataset.wired = "1";

  const emojis = ["😀","😂","😍","😢","😮","🙏","👍","❤️","🔥","🎉","😅","😎"];
  panel.innerHTML = emojis.map((e) => `<span class="emoji-opt">${e}</span>`).join("");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
  });

  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.classList.contains("emoji-opt")) {
      $("#composer-input").value += e.target.textContent;
      panel.classList.add("hidden");
      $("#composer-input").focus();
    }
  });

  // إغلاق اللوحة تلقائياً عند النقر خارجها في أي مكان بالصفحة
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.add("hidden");
    }
  });
}

// ---------------------------------------------------------------
// PWA
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", boot);
