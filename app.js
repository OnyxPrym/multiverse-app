// ============================================================
// KARANKA MULTIVERSE - app.js
// Phase 3A: Auth + Profile (Supabase)
// ============================================================

let currentUser = null;
let currentProfile = null;
let acctType = 'personal';
let activeChatId = null;
let unsubMessages = null;
let unsubChats = null;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function showAuthTab(tab){
  document.getElementById('tabLogin').classList.toggle('active', tab==='login');
  document.getElementById('tabSignup').classList.toggle('active', tab==='signup');
  document.getElementById('loginForm').style.display = tab==='login' ? 'block' : 'none';
  document.getElementById('signupForm').style.display = tab==='signup' ? 'block' : 'none';
}

function setAcctType(t){
  acctType = t;
  document.getElementById('typePersonal').classList.toggle('active', t==='personal');
  document.getElementById('typeBusiness').classList.toggle('active', t==='business');
  document.getElementById('unameLabel').textContent = t==='business' ? 'Business name' : 'Username';
  document.getElementById('displayNameField').style.display = t==='business' ? 'none' : 'block';
  document.getElementById('unameAvail').textContent = '';
}

let availTimer = null;
function checkAvailability(){
  clearTimeout(availTimer);
  const raw = document.getElementById('suUsername').value.trim().toLowerCase().replace('@','');
  const el = document.getElementById('unameAvail');
  if(!raw){ el.textContent=''; return; }
  availTimer = setTimeout(async ()=>{
    const { data, error } = await sb
      .from('names')
      .select('name')
      .eq('name', raw)
      .maybeSingle();
    if(error){ el.textContent=''; return; }
    if(data){ el.textContent = 'Already taken'; el.className='avail no'; }
    else { el.textContent = 'Available \u2713'; el.className='avail ok'; }
  }, 350);
}

async function doSignup(){
  const email = document.getElementById('suEmail').value.trim();
  const password = document.getElementById('suPassword').value;
  const nameRaw = document.getElementById('suUsername').value.trim();
  const nameKey = nameRaw.toLowerCase().replace('@','');
  const display = document.getElementById('suDisplay').value.trim();
  const errEl = document.getElementById('signupError');
  errEl.textContent = '';

  if(!email || !password || !nameRaw){ errEl.textContent = 'Please fill in every field.'; return; }
  if(password.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; return; }

  try{
    const { data: signUpData, error: signUpErr } = await sb.auth.signUp({ email, password });
    if(signUpErr) throw signUpErr;
    const uid = signUpData.user && signUpData.user.id;
    if(!uid) throw new Error('Signup succeeded but no user id returned.');

    const { error: nameErr } = await sb.from('names').insert({
      name: nameKey,
      kind: acctType === 'business' ? 'business' : 'username',
      uid: uid
    });
    if(nameErr){
      if(nameErr.code === '23505') throw new Error('That name was just taken. Try another.');
      throw nameErr;
    }

    const { error: profErr } = await sb.from('profiles').insert({
      id: uid,
      email: email,
      account_type: acctType,
      username: acctType === 'personal' ? nameKey : null,
      business_name: acctType === 'business' ? nameKey : null,
      display_name: acctType === 'business' ? nameRaw : (display || nameRaw),
      theme: 'black'
    });
    if(profErr) throw profErr;

    await loadProfileAndEnterApp(uid);
  }catch(e){
    errEl.textContent = e.message || String(e);
  }
}

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try{
    const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
    if(error) throw error;
    await loadProfileAndEnterApp(data.user.id);
  }catch(e){
    errEl.textContent = e.message || String(e);
  }
}

async function doLogout(){
  if(unsubMessages) unsubMessages();
  if(unsubChats) unsubChats();
  await sb.auth.signOut();
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
}

async function loadProfileAndEnterApp(uid){
  const userResult = await sb.auth.getUser();
  const user = userResult.data ? userResult.data.user : null;
  currentUser = user || { id: uid };

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .maybeSingle();

  if(error){ console.error('Profile load failed:', error); return; }
  if(!profile){
    document.getElementById('signupError').textContent =
      'Your account is missing a profile. Please sign up again with a different email.';
    await sb.auth.signOut();
    return;
  }

  currentProfile = profile;
  setTheme(profile.theme || 'black', false);

  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';

  if(typeof listenToChats === 'function') listenToChats();
  if(typeof loadStatusFeed === 'function') loadStatusFeed();
}

async function setTheme(t, persist){
  if(typeof persist === 'undefined') persist = true;
  document.body.setAttribute('data-theme', t);
  const bw = document.getElementById('btnWhite');
  const bb = document.getElementById('btnBlack');
  if(bw) bw.classList.toggle('active', t==='white');
  if(bb) bb.classList.toggle('active', t==='black');
  if(persist && currentUser){
    await sb.from('profiles').update({ theme: t }).eq('id', currentUser.id);
    if(currentProfile) currentProfile.theme = t;
  }
}

function openProfile(){
  document.getElementById('profileDisplayName').value = currentProfile.display_name || '';
  document.getElementById('profileUsername').value =
    '@' + (currentProfile.username || currentProfile.business_name || '');
  document.getElementById('profilePicPreview').src =
    currentProfile.profile_picture_url || 'assets/logo.png';
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileBackdrop').classList.add('show');
}
function closeProfile(){ document.getElementById('profileBackdrop').classList.remove('show'); }

async function uploadProfilePic(){
  const fileInput = document.getElementById('profilePicInput');
  const file = fileInput.files[0];
  if(!file) return;
  if(file.size > MAX_UPLOAD_BYTES){
    document.getElementById('profileError').textContent = 'Photo must be under 10 MB.';
    fileInput.value = '';
    return;
  }
  const parts = file.name.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
  const path = 'profilePictures/' + currentUser.id + '/photo.' + ext;

  const { error: upErr } = await sb.storage.from('media').upload(path, file, { upsert: true });
  if(upErr){ document.getElementById('profileError').textContent = upErr.message; return; }

  const { data: urlData } = sb.storage.from('media').getPublicUrl(path);
  const url = urlData.publicUrl + '?t=' + Date.now();

  const { error: dbErr } = await sb
    .from('profiles')
    .update({ profile_picture_url: url })
    .eq('id', currentUser.id);
  if(dbErr){ document.getElementById('profileError').textContent = dbErr.message; return; }

  currentProfile.profile_picture_url = url;
  document.getElementById('profilePicPreview').src = url;
  document.getElementById('myStatusAvatar').src = url;
}

async function saveDisplayName(){
  const name = document.getElementById('profileDisplayName').value.trim();
  const errEl = document.getElementById('profileError'); errEl.textContent = '';
  if(!name){ errEl.textContent = "Display name can't be empty."; return; }

  const { error } = await sb
    .from('profiles')
    .update({ display_name: name })
    .eq('id', currentUser.id);
  if(error){ errEl.textContent = error.message; return; }

  currentProfile.display_name = name;
  closeProfile();
}

sb.auth.getSession().then(function(result){
  const session = result.data ? result.data.session : null;
  if(session && session.user){ loadProfileAndEnterApp(session.user.id); }
});

sb.auth.onAuthStateChange(function(event, session){
  if(event === 'SIGNED_OUT'){
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
  }
});


/* ============================================================
   PHASE 3B: CHAT + MESSAGES + VIDEO ATTACH
   ============================================================ */

let chatsChannel = null;
let messagesChannel = null;

function chatIdFor(uidA, uidB){
  return [uidA, uidB].sort().join('_');
}

async function startChatWithUsername(){
  const raw = document.getElementById('newChatUsername').value.trim().toLowerCase().replace('@','');
  if(!raw) return;

  const nameResult = await sb.from('names').select('uid').eq('name', raw).maybeSingle();
  const nameRow = nameResult.data;
  if(!nameRow){ alert('No user or business found with that name.'); return; }
  const otherUid = nameRow.uid;
  if(otherUid === currentUser.id){ alert("That's you!"); return; }

  const chatId = chatIdFor(currentUser.id, otherUid);
  const members = [currentUser.id, otherUid].sort();

  const existResult = await sb.from('chats').select('id').eq('id', chatId).maybeSingle();
  if(!existResult.data){
    await sb.from('chats').insert({
      id: chatId,
      member_a: members[0],
      member_b: members[1],
      last_message: ''
    });
  }
  document.getElementById('newChatUsername').value = '';
  openChat(chatId, raw);
}

async function listenToChats(){
  if(chatsChannel){ sb.removeChannel(chatsChannel); chatsChannel = null; }

  await refreshChatList();

  chatsChannel = sb
    .channel('chats-' + currentUser.id)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'chats' },
        function(){ refreshChatList(); })
    .subscribe();
}

async function refreshChatList(){
  const result = await sb
    .from('chats')
    .select('*')
    .or('member_a.eq.' + currentUser.id + ',member_b.eq.' + currentUser.id)
    .order('updated_at', { ascending: false });

  const chats = result.data;
  if(result.error){ console.error('chat list error', result.error); return; }

  const listEl = document.getElementById('chatList');
  listEl.innerHTML = '';

  for(const chat of (chats || [])){
    const otherUid = chat.member_a === currentUser.id ? chat.member_b : chat.member_a;

    const pResult = await sb
      .from('profiles')
      .select('display_name, username, business_name, profile_picture_url')
      .eq('id', otherUid)
      .maybeSingle();

    const profile = pResult.data;
    const label = profile
      ? (profile.display_name || profile.username || profile.business_name || 'Unknown')
      : 'Unknown';

    const div = document.createElement('div');
    div.className = 'contact' + (chat.id === activeChatId ? ' active' : '');

    let avatarInner;
    if(profile && profile.profile_picture_url){
      avatarInner = '<img class="avatar" src="' + profile.profile_picture_url + '" style="object-fit:cover;">';
    } else {
      avatarInner = '<div class="avatar">' + label.slice(0,2).toUpperCase() + '</div>';
    }

    div.innerHTML = avatarInner +
      '<div class="meta"><div class="name">' + label + '</div>' +
      '<div class="last">' + (chat.last_message || '').slice(0,30) + '</div></div>';

    div.onclick = function(){ openChat(chat.id, null); };
    listEl.appendChild(div);
  }
}

async function openChat(chatId, headerNameHint){
  closeSidebar();
  activeChatId = chatId;

  const headerName = document.getElementById('chatHeaderName');
  const headerActions = document.getElementById('chatHeaderActions');

  if(headerNameHint){
    headerName.textContent = '@' + headerNameHint;
  } else {
    const chatResult = await sb.from('chats').select('*').eq('id', chatId).maybeSingle();
    const chat = chatResult.data;
    if(chat){
      const otherUid = chat.member_a === currentUser.id ? chat.member_b : chat.member_a;
      const pResult = await sb
        .from('profiles')
        .select('display_name, username, business_name')
        .eq('id', otherUid)
        .maybeSingle();
      const profile = pResult.data;
      if(profile){
        headerName.textContent = profile.display_name || profile.username || profile.business_name || 'Chat';
      } else {
        headerName.textContent = 'Chat';
      }
    }
  }

  if(headerActions) headerActions.style.display = 'flex';

  document.getElementById('messages').innerHTML = '';
  if(messagesChannel){ sb.removeChannel(messagesChannel); messagesChannel = null; }

  await loadMessages(chatId);

  messagesChannel = sb
    .channel('messages-' + chatId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: 'chat_id=eq.' + chatId },
        function(){ loadMessages(chatId); })
    .subscribe();
}

async function loadMessages(chatId){
  const result = await sb
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  const msgs = result.data;
  if(result.error){ console.error('load messages error', result.error); return; }

  const container = document.getElementById('messages');
  container.innerHTML = '';

  for(const m of (msgs || [])){
    const div = document.createElement('div');
    div.className = 'bubble ' + (m.sender_id === currentUser.id ? 'out' : 'in');

    if(m.expired){
      div.textContent = 'Photo (expired)';
      div.style.opacity = '.6';
      div.style.fontStyle = 'italic';
    } else if(m.image_url && /\.(mp4|mov|webm)(\?|$)/i.test(m.image_url)){
      div.innerHTML = '<video src="' + m.image_url + '" controls style="max-width:200px;border-radius:10px;"></video>';
    } else if(m.image_url){
      div.innerHTML = '<img src="' + m.image_url + '">';
    } else if(m.text){
      div.textContent = m.text;
    }

    const t = document.createElement('span');
    t.className = 'time';
    if(m.created_at){
      const d = new Date(m.created_at);
      t.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    div.appendChild(t);
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

async function sendMsg(){
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if(!text || !activeChatId) return;
  input.value = '';

  await sb.from('messages').insert({
    chat_id: activeChatId,
    sender_id: currentUser.id,
    text: text
  });

  await sb.from('chats')
    .update({ last_message: text, updated_at: new Date().toISOString() })
    .eq('id', activeChatId);
}

async function sendImage(){
  const fileInput = document.getElementById('imgInput');
  const file = fileInput.files[0];
  if(!file || !activeChatId) return;

  if(file.size > MAX_UPLOAD_BYTES){
    alert('Image must be under 10 MB.');
    fileInput.value = '';
    return;
  }

  const parts = file.name.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
  const path = 'chatImages/' + activeChatId + '/' + Date.now() + '.' + ext;

  const upResult = await sb.storage.from('media').upload(path, file);
  if(upResult.error){ alert('Upload failed: ' + upResult.error.message); fileInput.value = ''; return; }

  const urlData = sb.storage.from('media').getPublicUrl(path);

  await sb.from('messages').insert({
    chat_id: activeChatId,
    sender_id: currentUser.id,
    image_url: urlData.data.publicUrl,
    storage_path: path,
    expired: false
  });

  await sb.from('chats')
    .update({ last_message: 'Photo', updated_at: new Date().toISOString() })
    .eq('id', activeChatId);

  fileInput.value = '';
}

async function sendVideo(){
  const fileInput = document.getElementById('videoInput');
  const file = fileInput.files[0];
  if(!file || !activeChatId) return;

  if(file.size > MAX_UPLOAD_BYTES){
    alert('Video must be under 10 MB.');
    fileInput.value = '';
    return;
  }

  const parts = file.name.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : 'mp4';
  const path = 'chatVideos/' + activeChatId + '/' + Date.now() + '.' + ext;

  const upResult = await sb.storage.from('media').upload(path, file);
  if(upResult.error){ alert('Upload failed: ' + upResult.error.message); fileInput.value = ''; return; }

  const urlData = sb.storage.from('media').getPublicUrl(path);

  await sb.from('messages').insert({
    chat_id: activeChatId,
    sender_id: currentUser.id,
    image_url: urlData.data.publicUrl,
    storage_path: path,
    expired: false
  });

  await sb.from('chats')
    .update({ last_message: 'Video', updated_at: new Date().toISOString() })
    .eq('id', activeChatId);

  fileInput.value = '';
}

function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('show');
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}


/* ============================================================
   PHASE 3C: CONTACTS + STATUS + EMOJI PICKER
   ============================================================ */

async function addContact(){
  const raw = document.getElementById('addContactUsername').value.trim().toLowerCase().replace('@','');
  if(!raw) return;

  const nameResult = await sb.from('names').select('uid').eq('name', raw).maybeSingle();
  const nameRow = nameResult.data;
  if(!nameRow){ alert('No user or business found with that name.'); return; }

  const otherUid = nameRow.uid;
  if(otherUid === currentUser.id){ alert("That's you!"); return; }

  const insResult = await sb.from('contacts').insert({
    owner_id: currentUser.id,
    contact_id: otherUid
  });
  if(insResult.error && insResult.error.code !== '23505'){
    alert('Could not add contact: ' + insResult.error.message);
    return;
  }

  document.getElementById('addContactUsername').value = '';
  loadStatusFeed();
}

/* ---------- STATUS ---------- */
let myStatuses = [];
let viewerQueue = [];
let viewerIndex = 0;
let viewerTimer = null;

function handleMyStatusClick(){
  if(myStatuses.length){ openStatusViewer('You', myStatuses); }
  else { document.getElementById('statusFileInput').click(); }
}

async function postStatus(){
  const fileInput = document.getElementById('statusFileInput');
  const file = fileInput.files[0];
  if(!file) return;

  const isVideo = file.type.indexOf('video/') === 0;
  const isImage = file.type.indexOf('image/') === 0;
  if(!isImage && !isVideo){ alert('Status must be a photo or video.'); fileInput.value=''; return; }

  if(file.size > MAX_UPLOAD_BYTES){
    alert('File must be under 10 MB.');
    fileInput.value = '';
    return;
  }

  const finishUpload = async function(){
    const parts = file.name.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : (isVideo ? 'mp4' : 'jpg');
    const path = 'status/' + currentUser.id + '/' + Date.now() + '.' + ext;

    const upResult = await sb.storage.from('media').upload(path, file);
    if(upResult.error){ alert('Upload failed: ' + upResult.error.message); return; }

    const urlData = sb.storage.from('media').getPublicUrl(path);

    const insResult = await sb.from('statuses').insert({
      user_id: currentUser.id,
      media_url: urlData.data.publicUrl,
      storage_path: path,
      media_type: isVideo ? 'video' : 'image'
    });
    if(insResult.error){ alert('Could not save status: ' + insResult.error.message); return; }

    fileInput.value = '';
    loadStatusFeed();
  };

  if(isVideo){
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = function(){
      URL.revokeObjectURL(video.src);
      if(video.duration > 60){
        alert('Videos for Status must be 1 minute or shorter.');
        fileInput.value = '';
        return;
      }
      finishUpload();
    };
    video.src = URL.createObjectURL(file);
  } else {
    finishUpload();
  }
}

async function loadStatusFeed(){
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const myResult = await sb
    .from('statuses')
    .select('*')
    .eq('user_id', currentUser.id)
    .gt('created_at', cutoff)
    .order('created_at', { ascending: true });

  myStatuses = myResult.data || [];
  document.getElementById('myStatusAvatar').src =
    currentProfile.profile_picture_url || 'assets/logo.png';

  const myRing = document.querySelector('#myStatusItem .status-ring');
  if(myRing) myRing.classList.toggle('has-status', myStatuses.length > 0);

  const contactsResult = await sb
    .from('contacts')
    .select('contact_id')
    .eq('owner_id', currentUser.id);

  const listEl = document.getElementById('contactStatusList');
  listEl.innerHTML = '';

  for(const row of (contactsResult.data || [])){
    const contactUid = row.contact_id;

    const pResult = await sb
      .from('profiles')
      .select('display_name, username, business_name, profile_picture_url')
      .eq('id', contactUid)
      .maybeSingle();

    const ud = pResult.data;
    if(!ud) continue;

    const sResult = await sb
      .from('statuses')
      .select('*')
      .eq('user_id', contactUid)
      .gt('created_at', cutoff)
      .order('created_at', { ascending: true });

    const statuses = sResult.data || [];
    if(!statuses.length) continue;

    const label = ud.display_name || ud.username || ud.business_name || 'Contact';

    const item = document.createElement('div');
    item.className = 'status-item';
    item.innerHTML =
      '<div class="status-ring has-status"><img src="' +
      (ud.profile_picture_url || 'assets/logo.png') + '"></div><span>' +
      label + '</span>';

    (function(name, sts){
      item.onclick = function(){ openStatusViewer(name, sts); };
    })(label, statuses);

    listEl.appendChild(item);
  }
}

function openStatusViewer(name, statuses){
  viewerQueue = statuses;
  viewerIndex = 0;
  document.getElementById('statusViewerName').textContent = name;

  const bars = document.getElementById('statusProgressBars');
  bars.innerHTML = '';
  for(let i = 0; i < statuses.length; i++){
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;height:3px;background:rgba(255,255,255,.3);border-radius:2px;overflow:hidden;';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.cssText = 'height:100%;width:0;background:#fff;';
    wrap.appendChild(fill);
    bars.appendChild(wrap);
  }

  document.getElementById('statusViewerBackdrop').classList.add('show');
  showViewerItem();
}

function showViewerItem(){
  clearTimeout(viewerTimer);
  if(viewerIndex >= viewerQueue.length){ closeStatusViewer(); return; }

  const item = viewerQueue[viewerIndex];
  const mediaEl = document.getElementById('statusViewerMedia');
  const bars = document.querySelectorAll('.bar-fill');
  bars.forEach(function(b, i){ b.style.width = i < viewerIndex ? '100%' : '0'; });

  if(item.media_type === 'video'){
    mediaEl.innerHTML =
      '<video src="' + item.media_url +
      '" autoplay style="max-width:100%;max-height:100%;" onended="nextStatusItem()"></video>';
  } else {
    mediaEl.innerHTML =
      '<img src="' + item.media_url +
      '" style="max-width:100%;max-height:100%;object-fit:contain;">';
    animateBar(bars[viewerIndex], 5000);
    viewerTimer = setTimeout(nextStatusItem, 5000);
  }
}

function animateBar(bar, duration){
  if(!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '0';
  requestAnimationFrame(function(){
    bar.style.transition = 'width ' + duration + 'ms linear';
    bar.style.width = '100%';
  });
}

function nextStatusItem(){ viewerIndex++; showViewerItem(); }

function closeStatusViewer(){
  clearTimeout(viewerTimer);
  document.getElementById('statusViewerBackdrop').classList.remove('show');
  document.getElementById('statusViewerMedia').innerHTML = '';
}

/* ---------- EMOJI PICKER ---------- */
function toggleEmoji(){ document.getElementById('emojiPanel').classList.toggle('show'); }

function showEmojiTab(tab){
  document.getElementById('gridStd').style.display = tab==='std' ? 'grid' : 'none';
  document.getElementById('gridEx').style.display = tab==='ex' ? 'grid' : 'none';
  const btns = document.querySelectorAll('.emoji-tabs button');
  btns.forEach(function(b, i){
    b.classList.toggle('active',
      (tab==='std' && i===0) || (tab==='ex' && i===1));
  });
}

document.addEventListener('click', function(e){
  if(e.target.matches('.emoji-grid span')){
    document.getElementById('msgInput').value += e.target.textContent;
  }
});


/* ============================================================
   CONTACTS LIST
   ============================================================ */
async function loadContactsList(){
  const container = document.getElementById('contactsList');
  if(!container) return;
  container.innerHTML = '<div class="contact-empty">Loading…</div>';

  const result = await sb
    .from('contacts')
    .select('contact_id, created_at')
    .eq('owner_id', currentUser.id)
    .order('created_at', { ascending: false });

  if(result.error){
    container.innerHTML = '<div class="contact-empty" style="color:#e5534b;">Could not load contacts: ' + result.error.message + '</div>';
    return;
  }

  const contacts = result.data || [];
  if(contacts.length === 0){
    container.innerHTML = '<div class="contact-empty">No contacts yet.</div>';
    return;
  }

  const uids = contacts.map(c => c.contact_id);
  const profResult = await sb
    .from('profiles')
    .select('id, display_name, username, business_name')
    .in('id', uids);
  const profileMap = {};
  (profResult.data || []).forEach(p => { profileMap[p.id] = p; });

  container.innerHTML = '';
  for(const c of contacts){
    const p = profileMap[c.contact_id] || {};
    const label = p.display_name || p.username || p.business_name || 'Unknown';
    const handle = p.username || p.business_name || '';

    const row = document.createElement('div');
    row.className = 'contact-row';
    row.innerHTML =
      '<div class="cavatar">' + label.charAt(0).toUpperCase() + '</div>' +
      '<div class="cname">' + label + '<small>@' + handle + '</small></div>' +
      '<div class="contact-actions">' +
        '<button class="mini-btn" data-act="chat">Chat</button>' +
        '<button class="mini-btn danger" data-act="del">✕</button>' +
        '<button class="mini-btn danger" data-act="blk">🚫</button>' +
      '</div>';

    row.querySelector('[data-act="chat"]').onclick = function(){
      const nm = document.getElementById('newChatUsername');
      if(nm && handle){ nm.value = handle; startChatWithUsername(); }
    };

    row.querySelector('[data-act="del"]').onclick = async function(){
      if(!confirm('Remove this contact?')) return;
      const del = await sb.from('contacts').delete()
        .eq('owner_id', currentUser.id).eq('contact_id', c.contact_id);
      if(del.error){ alert('Delete failed: ' + del.error.message); return; }
      await loadContactsList();
    };

    row.querySelector('[data-act="blk"]').onclick = async function(){
      if(!confirm('Block this user? They will be removed.')) return;
      const blk = await sb.from('blocked_users').insert({
        blocker_id: currentUser.id, blocked_id: c.contact_id
      });
      if(blk.error && blk.error.code !== '23505'){ alert('Block failed: ' + blk.error.message); return; }
      await sb.from('contacts').delete()
        .eq('owner_id', currentUser.id).eq('contact_id', c.contact_id);
      await loadContactsList();
      alert('Blocked.');
    };

    container.appendChild(row);
  }
}

/* Auto-load contacts after login */
window.addEventListener('load', function(){
  setTimeout(function(){
    if(currentUser && typeof loadContactsList === 'function') loadContactsList();
  }, 1500);
});


/* ============================================================
   GROUP CREATION
   ============================================================ */
let groupMemberDraft = [];

function openGroupModal(){
  groupMemberDraft = [];
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupMemberSearch').value = '';
  document.getElementById('groupCreateError').textContent = '';
  renderGroupDraft();
  document.getElementById('groupModalBackdrop').classList.add('show');
}
function closeGroupModal(){
  document.getElementById('groupModalBackdrop').classList.remove('show');
}
function renderGroupDraft(){
  const list = document.getElementById('groupMemberDraftList');
  if(groupMemberDraft.length === 0){
    list.innerHTML = '<div style="opacity:.5;font-size:.72rem;padding:6px;">No members added yet.</div>';
    return;
  }
  list.innerHTML = '';
  groupMemberDraft.forEach(function(m, i){
    const row = document.createElement('div');
    row.className = 'group-draft-row';
    row.innerHTML = '<div class="cavatar">' + (m.label||'?').charAt(0).toUpperCase() + '</div>' +
      '<div class="dname">' + m.label + ' <small style="opacity:.5;">@' + m.handle + '</small></div>';
    const btn = document.createElement('button');
    btn.className = 'mini-btn danger';
    btn.textContent = '✕';
    btn.onclick = function(){ groupMemberDraft.splice(i,1); renderGroupDraft(); };
    row.appendChild(btn);
    list.appendChild(row);
  });
}
async function addMemberToGroupDraft(){
  const raw = document.getElementById('groupMemberSearch').value.trim().toLowerCase().replace('@','');
  if(!raw) return;
  if(groupMemberDraft.some(function(m){ return m.handle === raw; })){
    document.getElementById('groupMemberSearch').value = '';
    return;
  }
  const res = await sb.from('names').select('uid, name').eq('name', raw).maybeSingle();
  if(res.error || !res.data){ alert('No user found with that username.'); return; }
  const uid = res.data.uid;
  if(uid === currentUser.id){ alert("You are already the owner."); return; }

  const prof = await sb.from('profiles').select('display_name, username, business_name').eq('id', uid).maybeSingle();
  const p = prof.data || {};
  const label = p.display_name || p.username || p.business_name || raw;
  const handle = p.username || p.business_name || raw;
  groupMemberDraft.push({ uid: uid, label: label, handle: handle });
  document.getElementById('groupMemberSearch').value = '';
  renderGroupDraft();
}
async function createGroup(){
  const name = document.getElementById('groupNameInput').value.trim();
  const err = document.getElementById('groupCreateError');
  err.textContent = '';
  if(!name){ err.textContent = 'Group needs a name.'; return; }

  const insGroup = await sb.from('groups').insert({
    name: name,
    owner_id: currentUser.id
  }).select().single();

  if(insGroup.error){ err.textContent = insGroup.error.message; return; }
  const gid = insGroup.data.id;

  const memberRows = groupMemberDraft.map(function(m){
    return { group_id: gid, user_id: m.uid, role: 'member', status: 'active' };
  });
  if(memberRows.length > 0){
    const insMembers = await sb.from('group_members').insert(memberRows);
    if(insMembers.error){ err.textContent = 'Group created but members failed: ' + insMembers.error.message; }
  }

  closeGroupModal();
  if(typeof refreshChatList === 'function') refreshChatList();
  if(typeof loadGroupList === 'function') loadGroupList();
  alert('Group "' + name + '" created!');
}

/* ============================================================
   LOAD GROUP LIST (shows groups you belong to in sidebar)
   ============================================================ */
async function loadGroupList(){
  const container = document.getElementById('groupList');
  if(!container) return;
  container.innerHTML = '';

  const memRes = await sb.from('group_members').select('group_id, role').eq('user_id', currentUser.id).eq('status','active');
  if(memRes.error || !memRes.data || memRes.data.length === 0) return;

  const ids = memRes.data.map(function(r){ return r.group_id; });
  const gRes = await sb.from('groups').select('id, name, owner_id').in('id', ids);
  if(gRes.error || !gRes.data) return;

  for(const g of gRes.data){
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = '<div class="gavatar">' + g.name.charAt(0).toUpperCase() + '</div>' +
      '<div><div class="gname">' + g.name + '</div><div class="gmeta">Group</div></div>';
    row.onclick = function(){ if(typeof openGroupChat === 'function') openGroupChat(g.id, g.name); };
    container.appendChild(row);
  }
}
