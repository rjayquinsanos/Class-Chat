// 1. Connect to your Supabase project. Replace BOTH placeholders.
const SUPABASE_URL = "https://jhobtbcpzcwouhacdwkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IZPP3Y4CtDRitfzmR986Cg_V_xv3BA5";
const configured = !SUPABASE_URL.includes("https://jhobtbcpzcwouhacdwkg.supabase.co") && !SUPABASE_PUBLISHABLE_KEY.includes("sb_publishable_IZPP3Y4CtDRitfzmR986Cg_V_xv3BA5");
const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

// 2. Page elements
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const displayNameInput = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authStatus = document.getElementById("auth-status");
const chatStatus = document.getElementById("chat-status");
const currentName = document.getElementById("current-name");
const messageList = document.getElementById("message-list");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

let currentUser = null;
let currentProfile = null;
let realtimeChannel = null;
let knownNames = {};

// 3. Helpers
function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? "#b42318" : "";
}
function showAuth() {
  authScreen.hidden = false;
  chatScreen.hidden = true;
}
function showChat() {
  authScreen.hidden = true;
  chatScreen.hidden = false;
}
function nameFor(userId) {
  return knownNames[userId] || "Unknown";
}
function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function addMessage({ id, user_id, content, created_at, display_name, isWeather = false }) {
  if (id && document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`)) return;
  const wrap = document.createElement("article");
  wrap.className = "message" + (user_id === currentUser?.id ? " mine" : "") + (isWeather ? " weather" : "");
  if (id) wrap.dataset.messageId = String(id);
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const author = document.createElement("strong");
  author.textContent = isWeather ? "WeatherBot" : (display_name || nameFor(user_id));
  const time = document.createElement("span");
  time.textContent = formatTime(created_at || new Date().toISOString());
  meta.append(author, time);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  wrap.append(meta, bubble);
  messageList.appendChild(wrap);
  messageList.scrollTop = messageList.scrollHeight;
}
async function loadNames() {
  const { data, error } = await sb.from("profiles").select("id, display_name");
  if (error) throw error;
  knownNames = {};
  for (const profile of data || []) knownNames[profile.id] = profile.display_name;
}
async function loadMessages() {
  const { data, error } = await sb.from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  messageList.replaceChildren();
  for (const row of data || []) addMessage(row);
}
async function startChat(user) {
  currentUser = user;
  const { data: profile, error } = await sb.from("profiles")
    .select("id, display_name").eq("id", user.id).single();
  if (error) throw error;
  currentProfile = profile;
  currentName.textContent = profile.display_name;
  showChat();
  await loadNames();
  await loadMessages();
  listenForChanges();
}
function listenForChanges() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel("class-chat-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const row = payload.new;
      if (!knownNames[row.user_id]) {
        try { await loadNames(); } catch (_) {}
      }
      addMessage(row);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
      const id = payload.old?.id;
      if (id !== undefined) {
        const node = document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
        if (node) node.remove();
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus(chatStatus, "Connected. Messages update in real time.");
    });
}

// 4. Sign up and log in
async function signUp() {
  if (!configured) throw new Error("Add your Supabase Project URL and Publishable key in script.js first.");
  const displayName = displayNameInput.value.trim();
  if (displayName.length < 2 || displayName.length > 24) {
    throw new Error("Your display name must be 2 to 24 characters.");
  }
  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  if (!data.session) {
    setStatus(authStatus, "Account created. If email confirmation is enabled, confirm your email, then log in.");
    return;
  }
  await startChat(data.user);
}
async function logIn() {
  if (!configured) throw new Error("Add your Supabase Project URL and Publishable key in script.js first.");
  const { data, error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(), password: passwordInput.value
  });
  if (error) throw error;
  await startChat(data.user);
}
document.getElementById("signup-button").addEventListener("click", async (event) => {
  event.preventDefault();
  setStatus(authStatus, "Creating account…");
  try { await signUp(); } catch (error) { setStatus(authStatus, error.message || "Could not sign up.", true); }
});
document.getElementById("login-button").addEventListener("click", async () => {
  setStatus(authStatus, "Logging in…");
  try { await logIn(); } catch (error) { setStatus(authStatus, error.message || "Could not log in.", true); }
});
authForm.addEventListener("submit", (event) => event.preventDefault());
document.getElementById("logout-button").addEventListener("click", async () => {
  if (realtimeChannel) await sb.removeChannel(realtimeChannel);
  const { error } = await sb.auth.signOut();
  if (error) setStatus(chatStatus, error.message, true);
  currentUser = null;
  currentProfile = null;
  messageList.replaceChildren();
  showAuth();
});

// 5. Send chat messages and handle the weather command
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content || content.length > 500) return;
  messageInput.value = "";
  if (content.toLowerCase().startsWith("/weather")) {
    const city = content.slice(8).trim();
    if (!city) { addMessage({ content: "Try /weather Manila.", isWeather: true }); return; }
    await getWeather(city);
    return;
  }
  if (content.startsWith("/")) {
    addMessage({ content: "Unknown command. Try /weather Manila.", isWeather: true });
    return;
  }
  sendButton.disabled = true;
  try {
    // Send only the text. The database derives user_id from the authenticated session.
    const { error } = await sb.from("messages").insert({ content });
    if (error) throw error;
    setStatus(chatStatus, "");
  } catch (error) {
    setStatus(chatStatus, "Could not send: " + error.message, true);
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

// 6. Open-Meteo weather bot. Bot messages are private and are not saved to Supabase.
async function getWeather(city) {
  const bot = (content) => addMessage({ content, isWeather: true });
  bot("Checking the weather in " + city + "…");
  const placeholder = messageList.lastElementChild;
  try {
    const geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(city) + "&count=1&language=en&format=json";
    const geoResponse = await fetch(geoUrl);
    if (!geoResponse.ok) throw new Error("Location search failed.");
    const geo = await geoResponse.json();
    if (!geo.results || !geo.results.length) {
      placeholder.querySelector(".bubble").textContent = "Sorry, I could not find " + city + ". Try a larger city.";
      return;
    }
    const place = geo.results[0];
    const weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=" +
      encodeURIComponent(place.latitude) + "&longitude=" + encodeURIComponent(place.longitude) +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&timezone=auto";
    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) throw new Error("Weather service returned an error.");
    const weather = await weatherResponse.json();
    const now = weather.current;
    const sky = weatherDescription(now.weather_code);
    placeholder.querySelector(".bubble").textContent =
      `${place.name}${place.country ? ", " + place.country : ""}\n` +
      `${sky} · ${now.temperature_2m}°C (feels like ${now.apparent_temperature}°C)\n` +
      `Wind: ${now.wind_speed_10m} km/h · Humidity: ${now.relative_humidity_2m}%`;
  } catch (error) {
    placeholder.querySelector(".bubble").textContent = "Weather service is not answering right now. Please try again later.";
  }
}
function weatherDescription(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Mainly clear / partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Current conditions";
}

// 7. Restore an existing session after refreshing.
(async function restoreSession() {
  if (!configured) {
    setStatus(authStatus, "Setup needed: add your Project URL and Publishable key to script.js.");
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    try { await startChat(session.user); }
    catch (error) { setStatus(authStatus, error.message || "Could not load your session.", true); showAuth(); }
  }
})();
