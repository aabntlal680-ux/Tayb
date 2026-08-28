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
  activeConversation: null, // { id, otherProfile }
  messages: [],
  reactions: {}, // messageId -> [{id, emoji, user_id}]
  replyingTo: null,
  msgChannel: null,
  typingChannel: null,
  reactionsChannel: null,
  presenceChannel: null,
  typingTimeout: null,
  onlineMap: {},
  heartbeatInterval: null,
  recording: null, // { mediaRecorder, chunks, stream, seconds, timerInterval }
  isOnline: navigator.onLine,
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------
async function boot() {
  document.body.setAttribute("data-theme", state.theme);
  wireAuthForms();

  try {
    await loadChatPanelPartial();
  } catch (error) {
    console.error("Failed to load chat panel:", error);
  }
  state.t = applyLanguage(state.lang); // بعد حقن الجزء الديناميكي حتى تُطبَّق data-i18n عليه أيضاً

  if (document.querySelector("#chat-panel")) wireChrome();

  let session = null;
  try {
    const result = await supabase.auth.getSession();
    session = result?.data?.session || null;
  } catch (error) {
    console.error("Failed to restore session:", error);
    showAuthError("تعذر الاتصال بخدمة الدخول. تحقق من الإنترنت وحاول مرة أخرى.");
  }

  if (session) {
    try {
      await enterApp();
    } catch (err) {
      console.error("Failed to enter app:", err);
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }

  window.addEventListener("beforeunload", () => {
    if (state.me) {
      navigator.sendBeacon &&
        navigator.sendBeacon("about:blank");
    }
  });
  document.addEventListener("visibilitychange", async () => {
    if (!state.me) return;
    try {
      if (document.visibilityState === "hidden") {
        await touchLastSeen(false);
      } else {
        await touchLastSeen(true);
      }
    } catch (err) {
      console.warn("Visibility change update error:", err);
    }
  });

  window.addEventListener("online", () => {
    state.isOnline = true;
    updateOfflineBanner();
    flushOutbox();
  });
  window.addEventListener("offline", () => {
    state.isOnline = false;
    updateOfflineBanner();
  });
  updateOfflineBanner();
}

function updateOfflineBanner() {
  const banner = $("#offline-banner");
  if (!banner) return;
  banner.classList.toggle("hidden", state.isOnline);
}

// تحميل واجهة المحادثة كملف HTML منفصل وحقنها في الصفحة
async function loadChatPanelPartial() {
  try {
    const partialUrl = new URL("../partials/chat-panel.html", import.meta.url);
    const res = await fetch(partialUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`تعذر تحميل واجهة المحادثة (${res.status})`);
    }
    const html = await res.text();
    const container = $("#chat-panel-container");
    if (container) container.innerHTML = html;
  } catch (err) {
    console.error("loadChatPanelPartial error:", err);
    throw err;
  }
}

function showAuthScreen() {
  const authEl = $("#auth-screen");
  const appEl = $("#app-shell");
  if (authEl) authEl.classList.remove("hidden");
  if (appEl) appEl.classList.add("hidden");
}

async function enterApp() {
  try {
    state.me = await getCurrentProfile();
  } catch (err) {
    console.error("getCurrentProfile error:", err);
    state.me = null;
  }
  
  if (!state.me) {
    showAuthScreen();
    return;
  }
  
  const authEl = $("#auth-screen");
  const appEl = $("#app-shell");
  const myName = $("#my-name");
  const myAvatar = $("#my-avatar");

  if (authEl) authEl.classList.add("hidden");
  if (appEl) appEl.classList.remove("hidden");
  if (myName) myName.textContent = state.me.display_name;
  if (myAvatar && state.me.avatar_url) myAvatar.src = state.me.avatar_url;
  
  applyThemeVars();

  try {
    await touchLastSeen(true);
  } catch (e) {}

  startHeartbeat();

  try {
    await loadContacts();
  } catch (e) {
    console.warn("loadContacts error during enterApp:", e);
  }

  try {
    subscribeGlobalPresence();
    subscribeInboxUpdates();
  } catch (e) {
    console.warn("Subscriptions error:", e);
  }

  if (state.isOnline) {
    try {
      await flushOutbox();
    } catch (e) {}
  }
}

async function touchLastSeen(online) {
  if (!state.me) return;
  try {
    await supabase
      .from("profiles")
      .update({ is_online: online, last_seen: new Date().toISOString() })
      .eq("id", state.me.id);
  } catch (err) {
    console.warn("touchLastSeen error:", err);
  }
}

function startHeartbeat() {
  clearInterval(state.heartbeatInterval);
  state.heartbeatInterval = setInterval(() => {
    if (document.visibilityState === "visible") {
      touchLastSeen(true).catch(() => {});
    }
  }, 25000);
}

// ---------------------------------------------------------------
// AUTH FORMS
// ---------------------------------------------------------------
function wireAuthForms() {
  const loginTab = $("#tab-login");
  const signupTab = $("#tab-signup");
  const loginForm = $("#login-form");
  const signupForm = $("#signup-form");
  if (!loginTab || !signupTab || !loginForm || !signupForm) return;

  loginTab.addEventListener("click", () => switchAuthTab("login"));
  signupTab.addEventListener("click", () => switchAuthTab("signup"));

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email")?.value.trim();
    const password = $("#login-password")?.value;
    try {
      await signIn({ email, password });
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#signup-email")?.value.trim();
    const password = $("#signup-password")?.value;
    const displayName = $("#signup-name")?.value.trim();
    const phone = $("#signup-phone")?.value.trim();
    try {
      const { session } = await signUp({ email, password, displayName, phone });
      if (!session) {
        showAuthError("تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.");
        switchAuthTab("login");
        return;
      }
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    }
  });
}

function switchAuthTab(which) {
  const tabLogin = $("#tab-login");
  const tabSignup = $("#tab-signup");
  const formLogin = $("#login-form");
  const formSignup = $("#signup-form");

  if (tabLogin) tabLogin.classList.toggle("active", which === "login");
  if (tabSignup) tabSignup.classList.toggle("active", which === "signup");
  if (formLogin) formLogin.classList.toggle("hidden", which !== "login");
  if (formSignup) formSignup.classList.toggle("hidden", which !== "signup");
}

function showAuthError(msg) {
  const text = msg || state.t?.error_generic || "حدث خطأ ما";
  const authScreen = $("#auth-screen");
  const authScreenVisible = authScreen && !authScreen.classList.contains("hidden");
  
  if (authScreenVisible) {
    const el = $("#auth-error");
    if (el) {
      el.textContent = text;
      el.classList.remove("hidden");
      setTimeout(() => el.classList.add("hidden"), 4000);
    }
  } else {
    const toast = $("#global-toast");
    if (toast) {
      toast.textContent = text;
      toast.classList.remove("hidden");
      clearTimeout(toast._hideTimeout);
      toast._hideTimeout = setTimeout(() => toast.classList.add("hidden"), 5000);
    }
  }
}

// ---------------------------------------------------------------
// CHROME
// ---------------------------------------------------------------
function wireChrome() {
  const settingsButton = $("#btn-settings");
  const settingsPanel = $("#settings-panel");
  const logoutButton = $("#btn-logout");
  if (!settingsButton || !settingsPanel || !logoutButton) return;

  settingsButton.addEventListener("click", () => settingsPanel.classList.toggle("hidden"));
  logoutButton.addEventListener("click", async () => {
    try {
      await signOut(state.me?.id);
    } catch (err) {
      console.warn("Signout error:", err);
    }
    location.reload();
  });

  $("#lang-toggle")?.addEventListener("click", () => {
    state.lang = state.lang === "ar" ? "en" : "ar";
    localStorage.setItem("wa_lang", state.lang);
    state.t = applyLanguage(state.lang);
  });

  $("#theme-toggle")?.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("wa_theme", state.theme);
    document.body.setAttribute("data-theme", state.theme);
    applyThemeVars();
  });

  $("#avatar-input")?.addEventListener("change", handleAvatarUpload);
  $("#wallpaper-input")?.addEventListener("change", handleWallpaperUpload);
  $("#btn-enable-push")?.addEventListener("click", async () => {
    try {
      const ok = await enablePushNotifications(state.me.id);
      showAuthError(ok ? "تم تفعيل الإشعارات ✅" : "تعذّر التفعيل — تحقق من إذن المتصفح أو مفتاح VAPID");
    } catch (err) {
      showAuthError("خطأ عند تفعيل الإشعارات: " + err.message);
    }
  });

  wireChatPanel();
  wireEmojiPicker();
}

// كل ما يخص لوحة المحادثة
function wireChatPanel() {
  const composerForm = $("#composer-form");
  const composerInput = $("#composer-input");
  if (!composerForm || !composerInput) return;

  composerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = composerInput;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await sendMessage({ content: text });
    } catch (err) {
      showAuthError(err.message);
    }
  });

  composerInput.addEventListener("input", handleTypingInput);
  $("#attach-input")?.addEventListener("change", handleAttachmentUpload);

  $("#back-to-list")?.addEventListener("click", () => {
    $("#chat-panel")?.classList.remove("mobile-visible");
    $("#sidebar")?.classList.remove("mobile-hidden");
  });

  $("#reply-preview-cancel")?.addEventListener("click", clearReply);

  $("#mic-btn")?.addEventListener("click", toggleRecording);
  $("#recording-cancel")?.addEventListener("click", cancelRecording);
}

function applyThemeVars() {
  if (state.me?.wallpaper_url) {
    const box = $("#chat-messages");
    if (box) box.style.backgroundImage = `url(${state.me.wallpaper_url})`;
  }
}

// ---------------------------------------------------------------
// CONTACTS / ROLE ROUTING
// ---------------------------------------------------------------
async function loadContacts() {
  if (!state.isOnline) {
    try {
      const cached = await getCachedContacts();
      renderContactsFromCache(cached || []);
    } catch (e) {
      console.warn("Error loading cached contacts:", e);
    }
    return;
  }
  try {
    await loadContactsFromNetwork();
  } catch (err) {
    console.warn("loadContactsFromNetwork failed, falling back to cache:", err);
    try {
      const cached = await getCachedContacts();
      renderContactsFromCache(cached || []);
    } catch (e) {}
  }
}

function renderContactsFromCache(cached) {
  const list = $("#contact-list");
  if (!list) return;
  list.innerHTML = "";
  $("#admins-heading")?.classList.add("hidden");
  $("#admins-section")?.classList.add("hidden");
  $("#users-heading")?.classList.add("hidden");
  $("#users-section")?.classList.add("hidden");
  cached.forEach((c) => list.appendChild(buildContactRow(c, { withUnread: !!c._unread })));
}

async function loadContactsFromNetwork() {
  const list = $("#contact-list");
  if (!state.me.is_admin) {
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("*")
      .in("email", ADMINS.map((a) => a.email));
    state.contacts = adminProfiles || [];
    if (list) list.innerHTML = "";
    $("#admins-heading")?.classList.add("hidden");
    $("#admins-section")?.classList.add("hidden");
    $("#users-heading")?.classList.add("hidden");
    $("#users-section")?.classList.add("hidden");
    state.contacts.forEach((c) => list && list.appendChild(buildContactRow(c, { withUnread: false })));
    await cacheContacts(state.contacts);
  } else {
    if (list) list.innerHTML = "";
    $("#admins-heading")?.classList.remove("hidden");
    $("#admins-section")?.classList.remove("hidden");
    $("#users-heading")?.classList.remove("hidden");
    $("#users-section")?.classList.remove("hidden");

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

    const adminsSec = $("#admins-section");
    const usersSec = $("#users-section");

    if (adminsSec) {
      adminsSec.innerHTML = "";
      (otherAdmins || []).forEach((c) => adminsSec.appendChild(buildContactRow(c, { withUnread: false })));
    }
    if (usersSec) {
      usersSec.innerHTML = "";
      userContacts.forEach((c) => usersSec.appendChild(buildContactRow(c, { withUnread: true })));
    }
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
  return row;
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
    showAuthError("هذا المشرف لم يُنشئ حسابه في التطبيق بعد، لا يمكن بدء محادثة معه حالياً.");
    return;
  }

  try {
    $("#chat-panel")?.classList.add("mobile-visible");
    $("#sidebar")?.classList.add("mobile-hidden");
    $("#chat-empty-state")?.classList.add("hidden");
    $("#chat-active")?.classList.remove("hidden");
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
    const hName = $("#chat-header-name");
    const hAvatar = $("#chat-header-avatar");
    if (hName) hName.textContent = otherProfile.display_name;
    if (hAvatar) hAvatar.src = otherProfile.avatar_url || "";

    await refreshPresenceLabel(otherProfile.id);
    await loadMessages(conversationId);
    await loadReactionsForConversation();
    subscribeToConversation(conversationId);
    await markConversationRead(conversationId);
  } catch (err) {
    console.error("openConversation failed:", err);
    showAuthError(
      "تعذّر فتح المحادثة: " + (err?.message || "خطأ غير معروف") +
      " — تأكد من تشغيل sql/schema.sql بالكامل ومن صحة SUPABASE_URL/ANON_KEY في js/config.js"
    );
    $("#chat-panel")?.classList.remove("mobile-visible");
    $("#sidebar")?.classList.remove("mobile-hidden");
  }
}

async function loadMessages(conversationId) {
  try {
    const cached = await getCachedMessages(conversationId);
    if (cached && cached.length) {
      state.messages = cached;
      renderMessages();
    }
  } catch (e) {
    console.warn("getCachedMessages error:", e);
  }

  if (!state.isOnline) return;

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) return;

    state.messages = data || [];
    renderMessages();
    await cacheMessages(conversationId, state.messages);
  } catch (err) {
    console.warn("loadMessages network error:", err);
  }
}

async function loadReactionsForConversation() {
  state.reactions = {};
  const ids = state.messages.map((m) => m.id);
  if (!ids.length) return;
  try {
    const { data } = await supabase.from("message_reactions").select("*").in("message_id", ids);
    (data || []).forEach((r) => {
      if (!state.reactions[r.message_id]) state.reactions[r.message_id] = [];
      state.reactions[r.message_id].push(r);
    });
    renderMessages();
  } catch (err) {
    console.warn("loadReactionsForConversation error:", err);
  }
}

function renderMessages() {
  const box = $("#chat-messages");
  if (!box) return;
  box.innerHTML = "";
  if (!state.messages.length) {
    box.innerHTML = `<div class="empty-chat">${state.t?.no_messages || "لا توجد رسائل"}</div>`;
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
      attach = `<a class="msg-file" href="${m.attachment_url}" target="_blank">📎 ${state.t?.attach || "ملف"}</a>`;
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

  div.innerHTML = `
    <div class="bubble">
      <div class="bubble-actions">
        <button class="bubble-action-reply" title="${state.t?.reply || "رد"}">↩</button>
        <button class="bubble-action-react" title="React">😊</button>
      </div>
      ${quotedHtml}
      ${attach}
      ${m.content ? `<div class="bubble-text">${escapeHtml(m.content)}</div>` : ""}
      <div class="bubble-meta"><span class="bubble-time">${time}</span>${ticks}</div>
      ${reactionsHtml}
      <div class="quick-react-panel hidden"></div>
    </div>`;

  div.querySelector(".bubble-action-reply")?.addEventListener("click", () => setReplyTarget(m));
  const reactBtn = div.querySelector(".bubble-action-react");
  const quickPanel = div.querySelector(".quick-react-panel");
  const quickEmojis = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
  if (quickPanel) {
    quickPanel.innerHTML = quickEmojis
      .map((e) => `<span class="quick-react-opt" data-emoji="${e}">${e}</span>`)
      .join("");
    reactBtn?.addEventListener("click", () => quickPanel.classList.toggle("hidden"));
    quickPanel.addEventListener("click", (e) => {
      const emoji = e.target.dataset.emoji;
      if (emoji) {
        toggleReaction(m.id, emoji);
        quickPanel.classList.add("hidden");
      }
    });
  }
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
  if (!bubble) return;
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

    e.preventDefault();
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
  const pText = $("#reply-preview-text");
  const pBar = $("#reply-preview-bar");
  if (pText) pText.textContent = messagePreviewText(m);
  if (pBar) pBar.classList.remove("hidden");
  $("#composer-input")?.focus();
}

function clearReply() {
  state.replyingTo = null;
  $("#reply-preview-bar")?.classList.add("hidden");
}

// ---------------------------------------------------------------
// REACTIONS
// ---------------------------------------------------------------
async function toggleReaction(messageId, emoji) {
  try {
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
  } catch (err) {
    console.error("toggleReaction error:", err);
  }
}

// ---------------------------------------------------------------
// SEND MESSAGE / ATTACHMENTS
// ---------------------------------------------------------------
async function sendMessage({ content, attachmentUrl, attachmentType }) {
  const conv = state.activeConversation;
  if (!conv) return;
  const replyToId = state.replyingTo?.id || null;

  if (!state.isOnline) {
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

  try {
    await supabase
      .from("conversations")
      .update({ last_message: content || messagePreviewText({ attachment_type: attachmentType }), last_message_at: new Date().toISOString() })
      .eq("id", conv.id);
  } catch (e) {}

  clearReply();
  await setTyping(false);
}

async function flushOutbox() {
  try {
    const pending = await getOutbox();
    if (!pending || !pending.length) return;
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
    if (state.activeConversation) {
      state.messages = state.messages.filter((m) => !m._pending);
      await loadMessages(state.activeConversation.id);
    }
  } catch (err) {
    console.warn("flushOutbox error:", err);
  }
}

async function handleAttachmentUpload(e) {
  const file = e.target.files[0];
  if (!file || !state.activeConversation) return;
  try {
    const path = `${state.me.id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("attachments").upload(path, file);
    if (error) { showAuthError(error.message); return; }
    const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
    const type = file.type.startsWith("image/") ? "image" : "file";
    await sendMessage({ content: null, attachmentUrl: pub.publicUrl, attachmentType: type });
  } catch (err) {
    showAuthError("فشل رفع الملف: " + err.message);
  } finally {
    e.target.value = "";
  }
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const path = `${state.me.id}/avatar_${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) { showAuthError(error.message); return; }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", state.me.id);
    state.me.avatar_url = pub.publicUrl;
    const avatarImg = $("#my-avatar");
    if (avatarImg) avatarImg.src = pub.publicUrl;
  } catch (err) {
    showAuthError("فشل تغيير الصورة الشخصية: " + err.message);
  }
}

async function handleWallpaperUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const path = `${state.me.id}/wall_${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("wallpapers").upload(path, file, { upsert: true });
    if (error) { showAuthError(error.message); return; }
    const { data: pub } = supabase.storage.from("wallpapers").getPublicUrl(path);
    await supabase.from("profiles").update({ wallpaper_url: pub.publicUrl }).eq("id", state.me.id);
    state.me.wallpaper_url = pub.publicUrl;
    applyThemeVars();
  } catch (err) {
    showAuthError("فشل رفع الخلفية: " + err.message);
  }
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
    $("#recording-bar")?.classList.remove("hidden");
    $("#composer-input")?.classList.add("hidden");
    const micBtn = $("#mic-btn");
    if (micBtn) {
      micBtn.textContent = "⏹";
      micBtn.classList.add("recording-active");
    }

    state.recording.timerInterval = setInterval(() => {
      state.recording.seconds += 1;
      const mm = String(Math.floor(state.recording.seconds / 60)).padStart(2, "0");
      const ss = String(state.recording.seconds % 60).padStart(2, "0");
      const timer = $("#recording-timer");
      if (timer) timer.textContent = `${mm}:${ss}`;
    }, 1000);
  } catch (err) {
    showAuthError("لم يتم منح إذن الوصول للميكروفون");
  }
}

async function stopAndSendRecording() {
  const rec = state.recording;
  if (!rec) return;
  try {
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
  } catch (err) {
    showAuthError("خطأ في حفظ التسجيل: " + err.message);
    resetRecordingUI();
  }
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
  $("#recording-bar")?.classList.add("hidden");
  const timer = $("#recording-timer");
  if (timer) timer.textContent = "00:00";
  $("#composer-input")?.classList.remove("hidden");
  const micBtn = $("#mic-btn");
  if (micBtn) {
    micBtn.textContent = "🎤";
    micBtn.classList.remove("recording-active");
  }
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
        cacheMessages(conversationId, [payload.new]).catch(() => {});
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
          $("#typing-indicator")?.classList.toggle("hidden", !row.is_typing);
        }
      }
    )
    .subscribe();

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
  try {
    await supabase
      .from("messages")
      .update({ status: "read" })
      .eq("conversation_id", conversationId)
      .neq("sender_id", state.me.id)
      .neq("status", "read");
  } catch (err) {
    console.warn("markConversationRead error:", err);
  }
}

function handleTypingInput() {
  setTyping(true).catch(() => {});
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => setTyping(false).catch(() => {}), 2000);
}

async function setTyping(isTyping) {
  const conv = state.activeConversation;
  if (!conv) return;
  try {
    await supabase.from("typing_status").upsert(
      {
        conversation_id: conv.id,
        user_id: state.me.id,
        is_typing: isTyping,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,user_id" }
    );
  } catch (e) {}
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
  if (!label) return;
  if (state.onlineMap[otherId]) {
    label.textContent = state.t?.online || "متصل الآن";
    return;
  }
  try {
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
      label.textContent = `${state.t?.last_seen || "آخر ظهور"} ${dateLabel}`;
    } else {
      label.textContent = "";
    }
  } catch (e) {
    label.textContent = "";
  }
}

function subscribeInboxUpdates() {
  supabase
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

  const emojis = [
    // وجوه وانفعالات
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "🥹", "☺️", "😊", 
    "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", 
    "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", 
    "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", 
    "😢", "😭", "😮‍💨", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", 
    "😨", "😰", "😥", "😓", "🫣", "🤗", "🫡", "🤔", "🤫", "🫠", "🤥", 
    "😶", "😶‍🌫️", "😐", "😑", "😬", "🫨", "😯", "😦", "😧", "😮", "😲", ""🥱", 
    "😴", "🤤", "😪", "😵", "😵‍💫", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒",

    // الإشارات والأيدي
    "👍", "👎", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", 
    "💪", "🦾", "🖐️", "✋", "🤚", "👋", "🤙", "🤌", "🤏", "👌", "🫰", "✌️", 
    "🤞", "🤟", "🤘", "👈", "👉", "👆", "🖕", "👇", "☝️", "🫵", "🤜", "🤛",

    // القلوب والمشاعر
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", 
    "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "🫀", "✨", "💥", "🔥", 

    // أنشطة واحتفالات وأشياء
    "🎉", "🎊", "🎈", "🎂", "🎁", "⭐", "🌟", "💫", "💯", "✅", "❌", "⚠️", 
    "☕", "🍕", "🍔", "🍟", "⚽", "🏀", "🚀", "📱", "💻", "📸", "🎵", "🎧"
  ];

  // حقن العناصر فقط إذا كانت اللوحة فارغة لمنع تكرار الـ HTML
  if (!panel.children.length) {
    panel.innerHTML = emojis.map((e) => `<span class="emoji-opt">${e}</span>`).join("");
  }

  // 1. فتح وإغلاق القائمة مع منع تسرب الحدث
  btn.onclick = (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
  };

  // 2. اختيار الإيموجي وإدراجه عند النقر
  panel.onclick = (e) => {
    e.stopPropagation();
    if (e.target.classList.contains("emoji-opt")) {
      const input = $("#composer-input");
      if (input) {
        input.value += e.target.textContent;
        panel.classList.add("hidden");
        input.focus();
      }
    }
  };

  // 3. إخفاء اللوحة تلقائياً عند النقر في أي مكان آخر بالصفحة
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.add("hidden");
    }
  });
}

// ---------------------------------------------------------------
// PWA & Cache Clear
// ---------------------------------------------------------------
if ('caches' in window) {
  caches.keys().then((names) => {
    for (let name of names) {
      caches.delete(name);
    }
  }).catch(() => {});
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", boot);
