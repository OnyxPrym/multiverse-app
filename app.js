// ============================================================
// KARANKA MULTIVERSE - app.js
// Phase 3A: Auth + Profile (Supabase)
// ============================================================

let currentUser = null;
let currentProfile = null;
let acctType = 'personal';
let activeChatId = null; window.activeChatId = null;
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
    if(session && session.user){
      loadProfileAndEnterApp(session.user.id);
    } else {
      document.getElementById('authScreen').style.display = 'flex';
      document.getElementById('appScreen').style.display = 'none';
    }
  }).catch(function(err){
    console.error('Session check failed:', err);
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
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

  // Load my contacts so we can hide "+ Add" if already saved
  let myContactIds = [];
  try {
    const cRes = await sb.from('contacts').select('contact_id').eq('owner_id', currentUser.id);
    myContactIds = (cRes.data || []).map(function(c){ return c.contact_id; });
  } catch(e){ console.error('contacts load failed', e); }

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
    div.setAttribute('data-chatid', chat.id);

    let avatarInner;
    if(profile && profile.profile_picture_url){
      avatarInner = '<img class="avatar" src="' + profile.profile_picture_url + '" style="object-fit:cover;">';
    } else {
      avatarInner = '<div class="avatar">' + label.slice(0,2).toUpperCase() + '</div>';
    }

    const alreadyContact = myContactIds.indexOf(otherUid) !== -1;
    const addBtnHtml = alreadyContact
      ? '<span style="font-size:.62rem;color:#3ecf6e;margin-left:6px;flex-shrink:0;">saved</span>'
      : '<button class="mini-btn chat-add-btn" data-add="' + otherUid + '" style="margin-left:6px;flex-shrink:0;">+ Add</button>';

    div.innerHTML = avatarInner +
      '<div class="meta" style="flex:1;min-width:0;"><div class="name">' + label + '</div>' +
      '<div class="last">' + (chat.last_message || '').slice(0,30) + '</div></div>' +
      addBtnHtml;

    listEl.appendChild(div);
  }

  // Attach event delegation ONCE (after building the list)
  if(!listEl.dataset.wired){
    listEl.dataset.wired = '1';
    listEl.addEventListener('click', function(ev){
      const addBtn = ev.target.closest('[data-add]');
      if(addBtn){
        ev.stopPropagation();
        const targetUid = addBtn.getAttribute('data-add');
        addBtn.disabled = true;
        addBtn.textContent = '...';
        sb.from('contacts').insert({ owner_id: currentUser.id, contact_id: targetUid }).then(function(ins){
          if(ins.error && ins.error.code !== '23505'){
            alert('Could not add: ' + ins.error.message);
            addBtn.disabled = false;
            addBtn.textContent = '+ Add';
            return;
          }
          addBtn.textContent = 'saved';
          addBtn.style.color = '#3ecf6e';
          addBtn.style.border = 'none';
          if(typeof loadContactsList === 'function') loadContactsList();
        });
        return;
      }
      const row = ev.target.closest('[data-chatid]');
      if(row){
        const cid = row.getAttribute('data-chatid');
        if(cid && typeof openChat === 'function') openChat(cid, null);
      }
    });
  }
}
async function openChat(chatId, headerNameHint){
    activeChatId = chatId; window.activeChatId = chatId;
    window.activeChatId = chatId; window.activeChatId = chatId;
    activeGroupId = null;
    window.activeGroupId = null;
    const _gsb = document.getElementById('groupSettingsBtn');
    if(_gsb) _gsb.style.display = 'none';
  try { closeSidebar(); } catch(e){ console.error('closeSidebar failed', e); }

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
        function(payload){ if(payload.new && payload.new.sender_id !== currentUser.id && typeof playBeep === 'function') playBeep(); loadMessages(chatId); })
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
    div.setAttribute('data-msgid', m.id);
    div.setAttribute('data-sender', m.sender_id);

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






/* ============================================================
   GROUP CHAT — full feature
   ============================================================ */
/* ============================================================
   GROUP v2 — full feature set
   ============================================================ */
var activeGroupId = null; window.activeGroupId = null; window.activeGroupId = null; window.activeGroupId = null;
var activeGroupName = null; window.activeGroupName = null;
let groupMessagesChannel = null;
let groupLogoDataUrl = null;

async function openGroupChat(groupId, groupName){
  // Close any existing 1-on-1 message subscription
  if(typeof messagesChannel !== 'undefined' && messagesChannel){
    try { sb.removeChannel(messagesChannel); messagesChannel = null; } catch(e){}
  }
  closeSidebar();
  activeGroupId = groupId; window.activeGroupId = groupId;
  activeGroupName = groupName;
  document.getElementById('chatHeaderName').textContent = groupName;
  const header = document.getElementById('chatHeader');
  let settingsBtn = document.getElementById('groupSettingsBtn');
  if(!settingsBtn){
    settingsBtn = document.createElement('button');
    settingsBtn.id = 'groupSettingsBtn';
    settingsBtn.className = 'icon-btn';
    settingsBtn.style.marginLeft = 'auto';
    settingsBtn.textContent = 'S';
    settingsBtn.title = 'Group settings';
    settingsBtn.onclick = function(){ openGroupSettings(groupId); };
    header.appendChild(settingsBtn);
  }
  settingsBtn.style.display = 'inline-block';
  await loadGroupMessages(groupId);
  subscribeGroupMessages(groupId);
}

async function loadGroupMessages(groupId){
  const container = document.getElementById('messages');
  if(!container) return;
  const res = await sb.from('group_messages').select('*').eq('group_id', groupId).order('created_at', { ascending: true });
  if(res.error){ container.innerHTML = '<div style="padding:12px;color:#e5534b;">Error: ' + res.error.message + '</div>'; return; }
  const msgs = res.data || [];
  if(msgs.length === 0){ container.innerHTML = '<div style="padding:20px;text-align:center;opacity:.5;font-size:.8rem;">No messages yet. Say hi 👋</div>'; return; }
  const uids = [];
  msgs.forEach(function(m){ if(uids.indexOf(m.sender_id) < 0) uids.push(m.sender_id); });
  const profRes = await sb.from('profiles').select('id, display_name, username, business_name').in('id', uids);
  const pmap = {};
  (profRes.data || []).forEach(function(p){ pmap[p.id] = p; });
  container.innerHTML = '';
  msgs.forEach(function(m){
    const p = pmap[m.sender_id] || {};
    const senderName = p.display_name || p.username || p.business_name || 'User';
    const mine = m.sender_id === currentUser.id;
    const div = document.createElement('div');
    div.className = 'bubble ' + (mine ? 'out' : 'in');
    div.setAttribute('data-msgid', m.id);
    div.setAttribute('data-sender', m.sender_id);
    
    let body = '';
    if(m.deleted){ body = '<i style="opacity:.6;">This message was deleted</i>'; }
    else if(m.image_url){ body = '<img src="' + m.image_url + '" style="max-width:200px;border-radius:10px;display:block;">'; }
    else if(m.audio_url){ body = '<audio controls src="' + m.audio_url + '" style="max-width:220px;"></audio>'; }
    else { body = (m.content || ''); }
    
    if(!mine){
      div.innerHTML = '<div style="font-size:.68rem;opacity:.7;margin-bottom:2px;"><b>' + senderName + '</b></div>' + body + '<div class="time">' + new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '</div>';
    } else {
      div.innerHTML = body + '<div class="time">' + new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '</div>';
    }
    
    attachLongPress(div, function(){
      showMessageMenu(m.id, m.sender_id, 'group_messages', 'group_id', groupId);
    });
    
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function subscribeGroupMessages(groupId){
  if(groupMessagesChannel){ sb.removeChannel(groupMessagesChannel); groupMessagesChannel = null; }
  groupMessagesChannel = sb.channel('group-' + groupId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: 'group_id=eq.' + groupId }, function(payload){ if(payload.new && payload.new.sender_id !== currentUser.id && typeof playBeep === 'function') playBeep(); loadGroupMessages(groupId); })
    .subscribe();
}

async function sendGroupMessage(){
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if(!content || !activeGroupId) return;
  input.value = '';
  const res = await sb.from('group_messages').insert({ group_id: activeGroupId, sender_id: currentUser.id, content: content });
  if(res.error){
    if(res.error.message.indexOf('policy') >= 0) alert('Only admins can post in this group.');
    else alert('Could not send: ' + res.error.message);
    return;
  }
  loadGroupMessages(activeGroupId);
}

function previewGroupLogo(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    groupLogoDataUrl = e.target.result;
    const preview = document.getElementById('groupLogoPreview');
    if(preview) preview.src = groupLogoDataUrl;
  };
  reader.readAsDataURL(file);
}

async function openGroupSettings(groupId){
  const gRes = await sb.from('groups').select('*').eq('id', groupId).single();
  if(gRes.error){ alert('Could not load group: ' + gRes.error.message); return; }
  const group = gRes.data;
  const memRes = await sb.from('group_members').select('user_id, role, status').eq('group_id', groupId);
  const members = memRes.data || [];
  const memberUids = members.map(function(m){ return m.user_id; });
  const profRes = await sb.from('profiles').select('id, display_name, username, business_name').in('id', memberUids);
  const pmap = {};
  (profRes.data || []).forEach(function(p){ pmap[p.id] = p; });
  const isOwner = members.some(function(m){ return m.user_id === currentUser.id && m.role === 'owner'; });
  const isAdmin = members.some(function(m){ return m.user_id === currentUser.id && (m.role === 'owner' || m.role === 'admin'); });
  let memberHtml = '';
  members.forEach(function(m){
    const p = pmap[m.user_id] || {};
    const name = p.display_name || p.username || p.business_name || 'Unknown';
    const isMe = m.user_id === currentUser.id;
    memberHtml += '<div class="member-row"><div class="member-name">' + name + (isMe ? ' (you)' : '') + '</div><div class="member-role">' + (m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : '') + '</div>' + (isAdmin && m.role !== 'owner' && !isMe ? '<button class="mini-btn" data-promote="' + m.user_id + '">' + (m.role === 'admin' ? 'Demote' : 'Promote') + '</button><button class="mini-btn danger" data-remove="' + m.user_id + '">X</button>' : '') + '</div>';
  });
  const html = '<div class="modal-backdrop show" id="groupSettingsBackdrop"><div class="modal" style="max-width:480px;"><button class="close-x" onclick="closeGroupSettings()">X</button><h2>' + group.name + '</h2>' + (isAdmin ? '<div class="settings-section"><div class="toggle-row"><label>Only admins can post</label><input type="checkbox" ' + (group.admin_only_posting ? 'checked' : '') + ' onchange="updateGroupSetting(\'' + groupId + '\', \'admin_only_posting\', this.checked)"></div><div class="toggle-row"><label>Require approval for new members</label><input type="checkbox" ' + (group.require_approval ? 'checked' : '') + ' onchange="updateGroupSetting(\'' + groupId + '\', \'require_approval\', this.checked)"></div><div class="toggle-row"><label>Enable invite link</label><input type="checkbox" ' + (group.invite_enabled ? 'checked' : '') + ' onchange="updateGroupSetting(\'' + groupId + '\', \'invite_enabled\', this.checked)"></div>' + (group.invite_enabled ? '<div class="invite-row"><input type="text" readonly value="' + (group.invite_token ? window.location.origin + '/?join=' + group.invite_token : 'No token yet') + '" id="inviteLinkInput">' + (group.invite_token ? '<button class="mini-btn" onclick="copyInvite()">Copy</button>' : '<button class="mini-btn" onclick="generateInviteToken(\'' + groupId + '\')">Generate</button>') + '</div>' : '') + '</div>' : '<p style="opacity:.6;font-size:.8rem;padding:8px;">Only admins can change settings.</p>') + '<h3 style="margin-top:16px;">Members</h3><div id="membersList">' + memberHtml + '</div>' + (isAdmin ? '<div class="add-member-section"><input type="text" id="addMemberInput" placeholder="@username to add"><button class="primary-btn" onclick="addMemberToGroup(\'' + groupId + '\')">Add</button></div>' : '') + (isOwner ? '<button class="mini-btn danger" style="margin-top:16px;width:100%;" onclick="deleteGroupForEveryone(\'' + groupId + '\')">Delete Group for Everyone</button>' : '') + '<button class="mini-btn danger" style="margin-top:8px;width:100%;" onclick="leaveGroup(\'' + groupId + '\')">Leave Group</button></div></div>';
  let wrap = document.getElementById('groupSettingsModal');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'groupSettingsModal';
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = html;
  wrap.classList.remove('hidden');
  wrap.querySelectorAll('[data-promote]').forEach(function(btn){ btn.onclick = function(){ promoteMember(groupId, btn.dataset.promote); }; });
  wrap.querySelectorAll('[data-remove]').forEach(function(btn){ btn.onclick = function(){ removeMember(groupId, btn.dataset.remove); }; });
}

function closeGroupSettings(){ const w = document.getElementById('groupSettingsModal'); if(w){ w.classList.add('hidden'); w.innerHTML = ''; } }

async function updateGroupSetting(groupId, field, value){
  const update = {};
  update[field] = value;
  const res = await sb.from('groups').update(update).eq('id', groupId);
  if(res.error){ alert('Update failed: ' + res.error.message); return; }
  if(field === 'invite_enabled' && value === true) openGroupSettings(groupId);
}

async function generateInviteToken(groupId){
  const token = Math.random().toString(36).substring(2, 12);
  const res = await sb.from('groups').update({ invite_token: token }).eq('id', groupId);
  if(res.error){ alert('Could not generate: ' + res.error.message); return; }
  openGroupSettings(groupId);
}

function copyInvite(){ const i = document.getElementById('inviteLinkInput'); if(i){ i.select(); document.execCommand('copy'); alert('Copied!'); } }

async function promoteMember(groupId, userId){
  const res = await sb.from('group_members').select('role').eq('group_id', groupId).eq('user_id', userId).single();
  if(res.error){ alert(res.error.message); return; }
  const newRole = res.data.role === 'admin' ? 'member' : 'admin';
  const upd = await sb.from('group_members').update({ role: newRole }).eq('group_id', groupId).eq('user_id', userId);
  if(upd.error){ alert('Failed: ' + upd.error.message); return; }
  openGroupSettings(groupId);
}

async function removeMember(groupId, userId){
  if(!confirm('Remove this member?')) return;
  const res = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  if(res.error){ alert('Failed: ' + res.error.message); return; }
  openGroupSettings(groupId);
}

async function addMemberToGroup(groupId){
  const raw = document.getElementById('addMemberInput').value.trim().toLowerCase().replace('@','');
  if(!raw) return;
  const nameRes = await sb.from('names').select('uid').eq('name', raw).maybeSingle();
  if(nameRes.error || !nameRes.data){ alert('User not found'); return; }
  const otherUid = nameRes.data.uid;
  const groupRes = await sb.from('groups').select('require_approval').eq('id', groupId).single();
  const needsApproval = groupRes.data && groupRes.data.require_approval;
  const insRes = await sb.from('group_members').insert({ group_id: groupId, user_id: otherUid, role: 'member', status: needsApproval ? 'pending' : 'active' });
  if(insRes.error){ alert('Failed: ' + insRes.error.message); return; }
  alert('Added' + (needsApproval ? ' (pending approval)' : ''));
  openGroupSettings(groupId);
}

async function leaveGroup(groupId){
  if(!confirm('Leave this group?')) return;
  const res = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', currentUser.id);
  if(res.error){ alert('Failed: ' + res.error.message); return; }
  closeGroupSettings();
  activeGroupId = null; window.activeGroupId = null;
  document.getElementById('chatHeaderName').textContent = 'Select or start a chat';
  const sb2 = document.getElementById('groupSettingsBtn');
  if(sb2) sb2.style.display = 'none';
  if(typeof refreshChatList === 'function') refreshChatList();
  if(typeof loadGroupList === 'function') loadGroupList();
}

async function deleteGroupForEveryone(groupId){
  if(!confirm('Delete this group for ALL members? This cannot be undone.')) return;
  const res = await sb.from('groups').delete().eq('id', groupId);
  if(res.error){ alert('Failed: ' + res.error.message); return; }
  closeGroupSettings();
  activeGroupId = null; window.activeGroupId = null;
  document.getElementById('chatHeaderName').textContent = 'Select or start a chat';
  const sb2 = document.getElementById('groupSettingsBtn');
  if(sb2) sb2.style.display = 'none';
  if(typeof loadGroupList === 'function') loadGroupList();
}



// Ensure group list loads on every page open
window.addEventListener('load', function(){
  setTimeout(function(){
    if(currentUser && typeof loadGroupList === 'function') loadGroupList();
  }, 500);
});






/* ============================================================
   NOTIFICATION SOUND
   ============================================================ */
let soundEnabled = true;
let notifyAudio = null;

function initSound(){
  try {
    notifyAudio = new Audio('assets/notify.mp3');
    notifyAudio.preload = 'auto';
    notifyAudio.volume = 0.7;
  } catch(e) {
    console.log('WAV not available, will use fallback beep');
    notifyAudio = null;
  }
}

function playBeep(){
  if(!soundEnabled) return;
  if(notifyAudio){
    try {
      notifyAudio.currentTime = 0;
      notifyAudio.play().catch(function(){ fallbackBeep(); });
      return;
    } catch(e) { /* fall through */ }
  }
  fallbackBeep();
}

function fallbackBeep(){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch(e) { /* silent fail */ }
}

async function loadSoundPreference(){
  if(!currentUser) return;
  const res = await sb.from('profiles').select('sound_enabled').eq('id', currentUser.id).maybeSingle();
  if(res.data && typeof res.data.sound_enabled === 'boolean'){
    soundEnabled = res.data.sound_enabled;
  }
}

async function toggleSound(){
  soundEnabled = !soundEnabled;
  const update = await sb.from('profiles').update({ sound_enabled: soundEnabled }).eq('id', currentUser.id);
  if(update.error){
    console.error('Could not save sound setting:', update.error.message);
  }
  const label = document.getElementById('soundToggleLabel');
  if(label) label.textContent = soundEnabled ? 'Sound ON' : 'Sound OFF';
  const cb = document.getElementById('soundToggleCheckbox');
  if(cb) cb.checked = soundEnabled;
  playBeep();
}

// Initialize on load
initSound();









/* ============================================================
   GROUP PHOTO + VOICE + DELETE
   ============================================================ */
async function sendGroupImage(){
  const fileInput = document.getElementById('imgInput');
  const file = fileInput.files[0];
  if(!file || !activeGroupId){ alert('Select a group first'); fileInput.value=''; return; }
  
  const parts = file.name.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
  const path = 'groupImages/' + activeGroupId + '/' + Date.now() + '.' + ext;
  
  const up = await sb.storage.from('media').upload(path, file);
  if(up.error){ alert('Upload failed: ' + up.error.message); fileInput.value=''; return; }
  
  const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  
  const ins = await sb.from('group_messages').insert({
    group_id: activeGroupId,
    sender_id: currentUser.id,
    content: '',
    image_url: url,
    storage_path: path
  });
  if(ins.error){ alert('Send failed: ' + ins.error.message); fileInput.value=''; return; }
  fileInput.value = '';
  loadGroupMessages(activeGroupId);
}

async function sendImageAuto(){
  if(window.activeGroupId) return sendGroupImage();
  return sendImage();
}

/* ============================================================
   VOICE NOTES
   ============================================================ */
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimer = null;
let recordingStart = 0;

async function startVoiceRecording(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert('Voice recording is not supported in this browser.'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    recordingStart = Date.now();
    
    mediaRecorder.ondataavailable = function(e){ if(e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async function(){
      stream.getTracks().forEach(function(t){ t.stop(); });
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      if(blob.size < 1000){ return; } // too short
      await uploadVoiceNote(blob);
    };
    
    mediaRecorder.start();
    
    // Show a recording indicator
    let indicator = document.getElementById('voiceIndicator');
    if(!indicator){
      indicator = document.createElement('div');
      indicator.id = 'voiceIndicator';
      indicator.className = 'voice-indicator';
      indicator.innerHTML = '<span class="voice-dot"></span><span id="voiceTimer">0:00</span> <button onclick="stopVoiceRecording()">Send</button> <button onclick="cancelVoiceRecording()">Cancel</button>';
      document.body.appendChild(indicator);
    }
    
    recordingTimer = setInterval(function(){
      const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const el = document.getElementById('voiceTimer');
      if(el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 500);
  } catch(e){
    alert('Microphone access denied. Please allow it in your browser settings.');
  }
}

function stopVoiceRecording(){
  if(mediaRecorder && mediaRecorder.state !== 'inactive'){ mediaRecorder.stop(); }
  if(recordingTimer){ clearInterval(recordingTimer); recordingTimer = null; }
  const ind = document.getElementById('voiceIndicator');
  if(ind) ind.remove();
}

function cancelVoiceRecording(){
  if(mediaRecorder){ mediaRecorder.onstop = function(){}; mediaRecorder.stop(); }
  if(recordingTimer){ clearInterval(recordingTimer); recordingTimer = null; }
  const ind = document.getElementById('voiceIndicator');
  if(ind) ind.remove();
}

async function uploadVoiceNote(blob){
  const ext = 'webm';
  let folder, table, idField;
  if(window.activeGroupId){
    folder = 'groupVoice/' + window.activeGroupId;
    table = 'group_messages';
    idField = 'group_id';
  } else if(activeChatId){
    folder = 'voice/' + activeChatId;
    table = 'messages';
    idField = 'chat_id';
  } else { return; }
  
  const path = folder + '/' + Date.now() + '.' + ext;
  const up = await sb.storage.from('media').upload(path, blob, { contentType: 'audio/webm' });
  if(up.error){ alert('Upload failed: ' + up.error.message); return; }
  
  const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  
  const row = { sender_id: currentUser.id, content: '', audio_url: url, storage_path: path };
  row[idField] = window.activeGroupId || activeChatId;
  
  const ins = await sb.from(table).insert(row);
  if(ins.error){ alert('Send failed: ' + ins.error.message); return; }
  
  if(window.activeGroupId) loadGroupMessages(window.activeGroupId);
  else if(activeChatId) loadMessages(activeChatId);
}

/* ============================================================
   DELETE MESSAGES — long press
   ============================================================ */
function attachLongPress(el, callback){
  let pressTimer = null;
  let longPressFired = false;
  let startX = 0, startY = 0;

  const start = function(e){
    longPressFired = false;
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX;
    startY = touch.clientY;
    pressTimer = setTimeout(function(){
      longPressFired = true;
      if(navigator.vibrate) navigator.vibrate(30);
      callback(e);
    }, 550);
  };

  const cancel = function(){
    if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; }
  };

  const move = function(e){
    if(!pressTimer) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);
    if(dx > 10 || dy > 10){ cancel(); }
  };

  // prevent the native context menu / text selection
  el.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  el.addEventListener('touchstart', function(e){
    e.preventDefault();
    start(e);
  }, { passive: false });

  el.addEventListener('touchend', function(e){
    if(longPressFired){ e.preventDefault(); }
    cancel();
  });

  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchcancel', cancel);

  // Desktop fallback
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
}

function showMessageMenu(messageId, senderId, table, chatField, chatId){
  const isMine = senderId === currentUser.id;
  const menu = document.createElement('div');
  menu.className = 'msg-menu';
  menu.id = 'msgMenu';
  menu.innerHTML = 
    '<div class="msg-menu-inner">' +
    '<button class="msg-menu-btn" data-act="me">Delete for me</button>' +
    (isMine ? '<button class="msg-menu-btn danger" data-act="all">Delete for everyone</button>' : '') +
    '<button class="msg-menu-btn" data-act="cancel">Cancel</button>' +
    '</div>';
  document.body.appendChild(menu);
  
  menu.querySelectorAll('button').forEach(function(b){
    b.onclick = function(){
      const act = b.dataset.act;
      menu.remove();
      if(act === 'cancel') return;
      if(act === 'me') deleteMessageForMe(messageId, table, chatField, chatId);
      if(act === 'all') deleteMessageForEveryone(messageId, table, chatField, chatId);
    };
  });
  setTimeout(function(){
    document.addEventListener('click', function closeMenu(ev){
      if(!menu.contains(ev.target)){ menu.remove(); document.removeEventListener('click', closeMenu); }
    });
  }, 100);
}

async function deleteMessageForMe(messageId, table, chatField, chatId){
  const ins = await sb.from('hidden_messages').insert({ message_id: messageId, user_id: currentUser.id });
  if(ins.error && ins.error.code !== '23505'){ alert('Failed: ' + ins.error.message); return; }
  if(table === 'group_messages') loadGroupMessages(chatId);
  else loadMessages(chatId);
}

async function deleteMessageForEveryone(messageId, table, chatField, chatId){
  const upd = await sb.from(table).update({ deleted: true, content: '', image_url: null, audio_url: null }).eq('id', messageId);
  if(upd.error){ alert('Failed: ' + upd.error.message); return; }
  if(table === 'group_messages') loadGroupMessages(chatId);
  else loadMessages(chatId);
}



