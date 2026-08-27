import { supabase } from "./supabaseClient.js";
import { signUp, signIn, signOut, getCurrentProfile } from "./auth.js";
import { ADMINS, isAdminEmail } from "./config.js";
import { applyLanguage } from "./i18n.js";

const state = {
  me: null, // current profile row
  t: null, // current i18n strings
  lang: localStorage.getItem("wa_lang") || "ar",
  theme: localStorage.getItem("wa_theme") || "dark",
  contacts: [], // profiles list to show in sidebar (admins, or admin's users)
  activeConversation: null, // { id, otherProfile }
  messages: [],
  msgChannel: null,
  typingChannel: null,
  presenceChannel: null,
  typingTimeout: null,
  onlineMap: {}, // profile_id -> bool
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------
async function boot() {
  document.body.setAttribute("data-theme", state.theme);
  state.t = applyLanguage(state.lang);

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await enterApp();
  } else {
    showAuthScreen();
  }

  wireAuthForms();
  wireChrome();
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

  await loadContacts();
  subscribeGlobalPresence();
  subscribeInboxUpdates();
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
  const el = $("#auth-error");
  el.textContent = msg || state.t.error_generic;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

// ---------------------------------------------------------------
// CHROME: settings, logout, language/theme toggles, composer
// ---------------------------------------------------------------
function wireChrome() {
  $("#btn-settings").addEventListener("click", () => $("#settings-panel").classList.toggle("hidden"));
  $("#btn-logout").addEventListener("click", async () => {
    await signOut(state.me?.id);
    location.reload();
  });

  $("#lang-toggle").addEventListener("click", () => {
    state.lang = state.lang === "ar" ? "en" : "ar";
    localStorage.setItem("wa_lang", state.lang);
    state.t = applyLanguage(state.lang);
  });

  $("#theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("wa_theme", state.theme);
    document.body.setAttribute("data-theme", state.theme);
    applyThemeVars();
  });

  $("#avatar-input").addEventListener("change", handleAvatarUpload);
  $("#wallpaper-input").addEventListener("change", handleWallpaperUpload);

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

  $("#back-to-list").addEventListener("click", () => {
    $("#chat-panel").classList.remove("mobile-visible");
    $("#sidebar").classList.remove("mobile-hidden");
  });

  wireEmojiPicker();
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
  const list = $("#contact-list");
  list.innerHTML = "";

  if (!state.me.is_admin) {
    // مستخدم عادي: يرى قائمة المشرفين الثابتة فقط
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("*")
      .in("email", ADMINS.map((a) => a.email));
    state.contacts = adminProfiles || ADMINS.map((a) => ({ email: a.email, display_name: a.name, id: null }));
    renderContactList(state.contacts, { withUnread: false });
  } else {
    // مشرف: المستوى الأول = بقية المشرفين
    const { data: otherAdmins } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_admin", true)
      .neq("id", state.me.id);

    // المستوى الثاني = المستخدمون الذين راسلوه، مع عداد غير مقروء
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

    renderContactSection($("#admins-section"), otherAdmins || [], { withUnread: false });
    renderContactSection($("#users-section"), userContacts, { withUnread: true });
  }
}

function renderContactList(contacts, opts) {
  const list = $("#contact-list");
  contacts.forEach((c) => list.appendChild(buildContactRow(c, opts)));
}

function renderContactSection(container, contacts, opts) {
  container.innerHTML = "";
  contacts.forEach((c) => container.appendChild(buildContactRow(c, opts)));
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
  if (!otherProfile.id) return; // المشرف لم يسجل دخول بعد

  $("#chat-panel").classList.add("mobile-visible");
  $("#sidebar").classList.add("mobile-hidden");

  let conversationId = otherProfile._conversationId;
  if (!conversationId) {
    const userId = state.me.is_admin ? otherProfile.id : state.me.id;
    const adminId = state.me.is_admin ? state.me.id : otherProfile.id;
    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .eq("admin_id", adminId)
      .maybeSingle();
    if (existing) {
      conversationId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ user_id: userId, admin_id: adminId })
        .select()
        .single();
      if (error) { showAuthError(error.message); return; }
      conversationId = created.id;
    }
  }

  state.activeConversation = { id: conversationId, otherProfile };
  $("#chat-header-name").textContent = otherProfile.display_name;
  $("#chat-header-avatar").src = otherProfile.avatar_url || "";
  updatePresenceLabel(otherProfile.id);

  await loadMessages(conversationId);
  subscribeToConversation(conversationId);
  await markConversationRead(conversationId);
}

async function loadMessages(conversationId) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  state.messages = data || [];
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

function buildMessageBubble(m) {
  const mine = m.sender_id === state.me.id;
  const div = document.createElement("div");
  div.className = `bubble-row ${mine ? "mine" : "theirs"}`;
  const time = new Date(m.created_at).toLocaleTimeString(state.lang === "ar" ? "ar-SA" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const ticks = mine ? renderTicks(m.status) : "";
  const attach = m.attachment_url
    ? m.attachment_type === "image"
      ? `<img class="msg-attachment" src="${m.attachment_url}">`
      : `<a class="msg-file" href="${m.attachment_url}" target="_blank">📎 ${state.t.attach}</a>`
    : "";
  div.innerHTML = `
    <div class="bubble">
      ${attach}
      ${m.content ? `<div class="bubble-text">${escapeHtml(m.content)}</div>` : ""}
      <div class="bubble-meta"><span class="bubble-time">${time}</span>${ticks}</div>
    </div>`;
  return div;
}

function renderTicks(status) {
  if (status === "read") return '<span class="ticks ticks-read">✓✓</span>';
  if (status === "delivered") return '<span class="ticks">✓✓</span>';
  return '<span class="ticks">✓</span>';
}

// ---------------------------------------------------------------
// SEND MESSAGE / ATTACHMENTS
// ---------------------------------------------------------------
async function sendMessage({ content, attachmentUrl, attachmentType }) {
  const conv = state.activeConversation;
  if (!conv) return;
  const { error } = await supabase.from("messages").insert({
    conversation_id: conv.id,
    sender_id: state.me.id,
    content: content || null,
    attachment_url: attachmentUrl || null,
    attachment_type: attachmentType || null,
    status: "sent",
  });
  if (error) { showAuthError(error.message); return; }

  await supabase
    .from("conversations")
    .update({ last_message: content || "📎", last_message_at: new Date().toISOString() })
    .eq("id", conv.id);

  await setTyping(false);
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
// REALTIME: messages, typing, presence, read receipts
// ---------------------------------------------------------------
function subscribeToConversation(conversationId) {
  if (state.msgChannel) supabase.removeChannel(state.msgChannel);
  if (state.typingChannel) supabase.removeChannel(state.typingChannel);

  state.msgChannel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      async (payload) => {
        state.messages.push(payload.new);
        renderMessages();
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
      if (state.activeConversation) updatePresenceLabel(state.activeConversation.otherProfile.id);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await state.presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}

function updatePresenceLabel(otherId) {
  const label = $("#chat-header-status");
  if (state.onlineMap[otherId]) {
    label.textContent = state.t.online;
  } else {
    label.textContent = "";
  }
}

function subscribeInboxUpdates() {
  // إعادة تحميل قائمة المحادثات عند وصول رسائل جديدة لأي محادثة يشارك فيها المستخدم
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
// EMOJI PICKER (basic quick-pick)
// ---------------------------------------------------------------
function wireEmojiPicker() {
  const btn = $("#emoji-toggle");
  const panel = $("#emoji-panel");
  const emojis = ["😀","😂","😍","😢","😮","🙏","👍","❤️","🔥","🎉","😅","😎"];
  panel.innerHTML = emojis.map((e) => `<span class="emoji-opt">${e}</span>`).join("");
  btn.addEventListener("click", () => panel.classList.toggle("hidden"));
  panel.addEventListener("click", (e) => {
    if (e.target.classList.contains("emoji-opt")) {
      $("#composer-input").value += e.target.textContent;
      panel.classList.add("hidden");
      $("#composer-input").focus();
    }
  });
}

// ---------------------------------------------------------------
// PWA
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => console.log(err));
  });
}

document.addEventListener("DOMContentLoaded", boot);
