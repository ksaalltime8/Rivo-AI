const $ = (selector) => document.querySelector(selector);
const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
let installations = [], availableGuilds = [], csrfToken = '', currentUser = null;
const value = (id) => $('#' + id)?.value?.trim() || '';
const checked = (id) => Boolean($('#' + id)?.checked);
const setValue = (id, next) => { const el = $('#' + id); if (!el) return; if (el.type === 'checkbox') el.checked = Boolean(next); else if (el.multiple && Array.isArray(next)) [...el.options].forEach(o => o.selected = next.includes(o.value)); else el.value = next ?? ''; };
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options = {}) {
  if (!csrfToken) { const response = await fetch('/api/csrf', { credentials: 'same-origin' }); const data = await response.json(); csrfToken = data.token || ''; }
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.method && options.method !== 'GET' ? {'X-CSRF-Token':csrfToken} : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}
function showLogin(error = '') { $('#loginGate').hidden = false; $('#dashboardApp').hidden = true; $('#logout').hidden = true; $('#loginError').textContent = error; }
function showApp() { $('#loginGate').hidden = true; $('#dashboardApp').hidden = false; $('#logout').hidden = false; }
function selectedInstallation() { return $('#installationSelect').value; }
function selectedGuild() { return installations.find(x => String(x._id) === selectedInstallation()); }
function setMessage(message, kind = '') { const node = $('#message'); if (node) { node.textContent = message; node.dataset.kind = kind; } }
function renderConnections(user, connections = {}) {
  for (const provider of ['kick','twitch','youtube']) {
    const connected = Boolean(connections[provider]);
    const status = $('#' + provider + 'Status');
    if (status) { status.textContent = connected ? 'Connected' : 'Not connected'; status.classList.toggle('is-connected', connected); }
    const connect = $('#' + provider + 'Connect'); if (connect) connect.hidden = connected;
    const action = document.querySelector(`[data-connect-action="${provider}"]`); if (action) action.hidden = !connected;
    const disconnect = document.querySelector(`[data-provider="${provider}"]`); if (disconnect) disconnect.hidden = !connected;
  }
  $('#kickName').textContent = user.providers?.kick?.username || 'Not connected';
  $('#twitchName').textContent = user.providers?.twitch?.username ? '@' + user.providers.twitch.username : 'Not connected';
  $('#youtubeName').textContent = user.providers?.youtube?.title || 'Not connected';
}
function renderGuildLists() {
  const linkedIds = new Set(installations.filter(x => x.provider === 'discord').map(x => String(x.externalId)));
  $('#availableGuilds').innerHTML = availableGuilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}${linkedIds.has(String(g.id)) ? ' · linked' : ''}</option>`).join('') || '<option value="">No manageable servers found</option>';
  const previous = selectedInstallation();
  const discord = installations.filter(x => x.provider === 'discord');
  $('#installationSelect').innerHTML = discord.map(x => `<option value="${x._id}">${escapeHtml(x.name || x.externalId)}</option>`).join('') || '<option value="">No linked Discord servers</option>';
  if (discord.some(x => String(x._id) === previous)) $('#installationSelect').value = previous;
  $('#guilds').textContent = `${availableGuilds.length} manageable server${availableGuilds.length === 1 ? '' : 's'} detected · ${discord.length} linked to your workspace.`;
}

async function refreshBotHealth(){try{const r=await fetch('/api/bot/status',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('status unavailable');const d=await r.json();const dot=$('#botHealthDot'),title=$('#botHealthTitle'),detail=$('#botHealthDetail');dot?.classList.toggle('is-online',d.status==='online');dot?.classList.toggle('is-offline',d.status==='offline');if(title)title.textContent=d.status==='online'?'Rivo is online':d.status==='offline'?'Rivo is offline':'Rivo status unavailable';if(detail)detail.textContent=d.status==='online'?'The Discord worker is responding normally.':d.status==='offline'?(d.lastSeenAt?'No heartbeat received recently. The worker may be restarting or offline.':'No Discord worker heartbeat has been received yet.'):'Waiting for the first Discord worker heartbeat.';if($('#botGuildCount'))$('#botGuildCount').textContent=d.guilds==null?'—':Number(d.guilds).toLocaleString();if($('#botLastSeen'))$('#botLastSeen').textContent=d.status==='online'?'Just now':d.lastSeenSeconds==null?'Never':`${Math.floor(d.lastSeenSeconds/60)}m ago`;}catch{if($('#botHealthTitle'))$('#botHealthTitle').textContent='Status unavailable';if($('#botHealthDetail'))$('#botHealthDetail').textContent='Could not reach the Rivo status service.';}}

async function load() {
  try {
    const me = await api('/api/me'); currentUser = me.user; showApp();
    const name = me.user.displayName || me.user.email || 'Discord member';
    $('#identity').textContent = `Signed in as ${name}`; $('#profileName').textContent = name;
    const avatar = $('#userAvatar'), fallback = $('#avatarFallback');
    if (me.user.avatar) { avatar.src = me.user.avatar; avatar.hidden = false; fallback.hidden = true; } else { avatar.hidden = true; fallback.hidden = false; }
    renderConnections(me.user, me.connections || {});
    const [i, g] = await Promise.all([api('/api/installations'), api('/api/guilds')]);
    installations = i.installations || []; availableGuilds = g.guilds || []; renderGuildLists();
    if (selectedInstallation()) await loadConfig(); else setMessage('Add a server above to start configuring Rivo.');
  } catch (error) {
    if (error.status === 401) return showLogin();
    showLogin(error.message || 'We could not load your Rivo workspace. Please try again.');
  }
}
async function fill(settings = {}) {
  const a = settings.automod || {}, w = settings.welcome || {}, goodbye = settings.goodbye || {}, logs = settings.logs || {}, level = settings.leveling || {}, tickets = settings.tickets || {}, suggestions = settings.suggestions || {}, roles = settings.autoroles || {}, security = settings.security || {}, star = settings.starboard || {}, alerts = settings.alerts || {}, tempVoice = settings.tempVoice || {};
  [['welcomeEnabled',w.enabled],['goodbyeEnabled',goodbye.enabled],['automodEnabled',a.enabled],['automodInvites',a.invites !== false],['automodLinks',a.links],['automodSpam',a.spam !== false],['automodCaps',a.caps],['automodMentions',a.mentions],['logsEnabled',logs.enabled],['levelingEnabled',level.enabled !== false],['ticketsEnabled',tickets.enabled],['suggestionsEnabled',suggestions.enabled],['autorolesEnabled',roles.enabled],['securityEnabled',security.enabled !== false],['antiSpam',security.antiSpam !== false],['antiInvite',security.antiInvite !== false],['raidMode',security.raidMode],['starboardEnabled',star.enabled],['alertsEnabled',alerts.enabled],['tempVoiceEnabled',tempVoice.enabled]].forEach(([id,v]) => setValue(id,v));
  [['welcomeMessage',w.message || 'Welcome {user} to {server}!'],['goodbyeMessage',goodbye.message || '{user} has left {server}.'],['badWords',(a.badWords || []).join(', ')],['xpMin',level.xpMin ?? 8],['xpMax',level.xpMax ?? 15],['joinThreshold',security.joinThreshold ?? 8],['joinWindow',security.joinWindowSeconds ?? 15],['starboardThreshold',star.threshold ?? 3]].forEach(([id,v]) => setValue(id,v));
  setValue('advancedJson', JSON.stringify({economy:settings.economy || {}, customCommands:settings.customCommands || [], automations:settings.automations || []}, null, 2));
  const guild = selectedGuild(); if (guild) await loadGuildResources(guild.externalId, {welcome:w.channelId,goodbye:goodbye.channelId,logs:logs.channelId,level:level.levelChannelId,suggestions:suggestions.channelId,starboard:star.channelId,alerts:alerts.channelId,category:tickets.categoryId,supportRole:tickets.supportRoleId,autoroles:roles.roleIds || [],tempVoice:tempVoice.lobbyChannelId});
}
async function loadGuildResources(guildId, chosen = {}) {
  try {
    const [channelData, roleData] = await Promise.all([api(`/api/guilds/${guildId}/channels`), api(`/api/guilds/${guildId}/roles`)]);
    const channels = channelData.channels || [], categories = channels.filter(c => c.type === 4), textChannels = channels.filter(c => [0,5].includes(c.type)), voiceChannels = channels.filter(c => c.type === 2), roles = roleData.roles || [];
    const channelOptions = (placeholder, selected) => `<option value="">${placeholder}</option>` + textChannels.map(c => `<option value="${c.id}" ${String(c.id) === String(selected || '') ? 'selected' : ''}># ${escapeHtml(c.name)}${c.type === 5 ? ' · announcements' : ''}</option>`).join('');
    for (const id of ['welcomeChannel','goodbyeChannel','logsChannel','levelChannel','suggestionsChannel','starboardChannel','alertsChannel']) $('#' + id).innerHTML = channelOptions(id === 'levelChannel' ? 'Use default channel' : 'Choose a text channel', chosen[id.replace('Channel','')] || (id === 'levelChannel' ? chosen.level : ''));
    $('#tempVoiceLobby').innerHTML = '<option value="">Choose a voice lobby</option>' + voiceChannels.map(c => `<option value="${c.id}" ${String(c.id) === String(chosen.tempVoice || '') ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    $('#ticketCategory').innerHTML = '<option value="">Choose a category</option>' + categories.map(c => `<option value="${c.id}" ${String(c.id) === String(chosen.category || '') ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const roleOptions = '<option value="">Choose a role</option>' + roles.map(r => `<option value="${r.id}" ${String(r.id) === String(chosen.supportRole || '') ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
    $('#supportRole').innerHTML = roleOptions;
    $('#autoroleIds').innerHTML = roles.map(r => `<option value="${r.id}" ${(chosen.autoroles || []).includes(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
    if (chosen.autoroles?.length) [...$('#autoroleIds').options].forEach(o => o.selected = chosen.autoroles.includes(o.value));
  } catch (error) { setMessage(error.message || 'Could not load this server’s channels and roles.', 'error'); }
}
async function loadConfig() {
  const id = selectedInstallation(); if (!id) return setMessage('Select a linked server first.');
  try { const data = await api(`/api/installations/${id}/config`); await fill(data.installation.settings || {}); setMessage(`Settings loaded for ${data.installation.name || 'your server'}.`); }
  catch (error) { setMessage(error.message, 'error'); }
}
function selectedValues(id) { return [...($('#' + id)?.selectedOptions || [])].map(o => o.value).filter(Boolean); }
function gatherSettings() {
  let advanced; try { advanced = JSON.parse(value('advancedJson') || '{}'); if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) throw new Error(); } catch { throw new Error('Advanced configuration must be a valid JSON object.'); }
  const guild = selectedGuild();
  return {
    welcome:{enabled:checked('welcomeEnabled'),channelId:value('welcomeChannel'),message:value('welcomeMessage')},
    goodbye:{enabled:checked('goodbyeEnabled'),channelId:value('goodbyeChannel'),message:value('goodbyeMessage')},
    automod:{enabled:checked('automodEnabled'),invites:checked('automodInvites'),links:checked('automodLinks'),spam:checked('automodSpam'),caps:checked('automodCaps'),mentions:checked('automodMentions'),badWords:split(value('badWords'))},
    logs:{enabled:checked('logsEnabled'),channelId:value('logsChannel')},
    leveling:{enabled:checked('levelingEnabled'),xpMin:Number(value('xpMin')),xpMax:Number(value('xpMax')),levelChannelId:value('levelChannel')},
    tickets:{enabled:checked('ticketsEnabled'),categoryId:value('ticketCategory'),supportRoleId:value('supportRole')},
    tempVoice:{enabled:checked('tempVoiceEnabled'),lobbyChannelId:value('tempVoiceLobby')},
    suggestions:{enabled:checked('suggestionsEnabled'),channelId:value('suggestionsChannel')},
    autoroles:{enabled:checked('autorolesEnabled'),roleIds:selectedValues('autoroleIds')},
    security:{enabled:checked('securityEnabled'),antiSpam:checked('antiSpam'),antiInvite:checked('antiInvite'),raidMode:checked('raidMode'),joinThreshold:Number(value('joinThreshold')),joinWindowSeconds:Number(value('joinWindow'))},
    starboard:{enabled:checked('starboardEnabled'),channelId:value('starboardChannel'),threshold:Number(value('starboardThreshold'))},
    alerts:{enabled:checked('alertsEnabled'),channelId:value('alertsChannel'),kickChannelIds:[],twitchBroadcasterIds:currentUser?.providers?.twitch?.id ? [currentUser.providers.twitch.id] : [],youtubeChannelIds:currentUser?.providers?.youtube?.channelId ? [currentUser.providers.youtube.channelId] : []},
    economy:advanced.economy || {}, customCommands:Array.isArray(advanced.customCommands) ? advanced.customCommands : [], automations:Array.isArray(advanced.automations) ? advanced.automations : []
  };
}
async function saveSettings() {
  try { const id = selectedInstallation(); if (!id) throw new Error('Add and select a Discord server first.'); const settings = gatherSettings(); const response = await api(`/api/installations/${id}/config`, {method:'PATCH',body:JSON.stringify({settings})}); setMessage('All settings saved successfully. Rivo will use the latest saved configuration.', 'success'); return response; }
  catch (error) { setMessage(error.message, 'error'); }
}
$('#saveConfig').addEventListener('click', saveSettings); $('#saveConfigBottom').addEventListener('click', saveSettings); $('#reloadConfig').addEventListener('click', loadConfig); $('#installationSelect').addEventListener('change', loadConfig);
$('#linkGuild').addEventListener('click', async () => { try { const id = $('#availableGuilds').value; const guild = availableGuilds.find(g => g.id === id); if (!guild) throw new Error('Choose a Discord server first.'); const result = await api('/api/installations', {method:'POST',body:JSON.stringify({provider:'discord',externalId:guild.id,name:guild.name})}); setMessage(`${guild.name} added to your workspace.`, 'success'); installations = [result.installation, ...installations.filter(x => String(x._id) !== String(result.installation._id))]; renderGuildLists(); $('#installationSelect').value = String(result.installation._id); await loadConfig(); } catch (error) { setMessage(error.message, 'error'); } });
$('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', {method:'POST',body:'{}'}); location.href = '/'; } catch (error) { setMessage(error.message, 'error'); } });
document.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', async () => { try { await api(`/api/connections/${button.dataset.provider}/disconnect`, {method:'POST',body:'{}'}); setMessage(`${button.dataset.provider} disconnected.`, 'success'); await load(); } catch (error) { setMessage(error.message, 'error'); } }));
document.querySelectorAll('[data-connect-action]').forEach(button => button.addEventListener('click', async () => { try { const provider = button.dataset.connectAction; await api(`/api/connections/${provider}/${provider === 'kick' ? 'activate' : 'subscribe'}`, {method:'POST',body:'{}'}); setMessage(`${provider} setup requested.`, 'success'); await load(); } catch (error) { setMessage(error.message, 'error'); } }));
const params = new URLSearchParams(location.search); if (params.has('error')) $('#loginError').textContent = 'Discord sign-in did not complete. Please try again.';
load();
refreshBotHealth(); setInterval(refreshBotHealth,30000);
