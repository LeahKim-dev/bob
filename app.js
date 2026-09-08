/* =========================
   오늘 뭐 먹지? - Supabase + Kakao
   (관리자만 로그인, 리뷰는 누구나 작성 가능)
   ========================= */
const KAKAO_JS_KEY = '0224242030f34b66b94d58cfb0786c40';
const SUPABASE_URL = 'https://awutnyafwvdytgguuhjr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Kj8Yj4sHEMO7vtgHaBQf1A_EwCptcFr';

// 학원 위치를 알고 있다면 좌표를 넣어두면 처음 지도 중심이 학원으로 잡혀요.
const ACADEMY = { name: '학원', lat: null, lng: null };

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (s, root=document) => root.querySelector(s);
function $$(s, root=document){ return [...root.querySelectorAll(s)]; }
const state = { user:null, profile:null, restaurants:[], map:null, markers:[], editingId:null, lastGeocode:null };

function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isAdmin(){return state.profile?.role==='admin';}
function show(id){$(id).classList.add('open')}
function hide(id){$(id).classList.remove('open')}

async function init(){
  await loadSession();
  db.auth.onAuthStateChange(async (_event, session)=>{ state.user=session?.user||null; await loadProfile(); updateAuthUI(); await loadRestaurants(); });
  loadKakaoMap();
}

async function loadSession(){const {data}=await db.auth.getSession();state.user=data.session?.user||null;await loadProfile();updateAuthUI();await loadRestaurants();}
async function loadProfile(){
  state.profile=null;if(!state.user)return;
  const {data,error}=await db.from('profiles').select('id,role').eq('id',state.user.id).maybeSingle();
  if(!error) state.profile=data;
}
function updateAuthUI(){
  $('#loginBtn').hidden=!!state.user;$('#logoutBtn').hidden=!state.user;$('#addBtn').hidden=!isAdmin();
  $('#authStatus').textContent=state.user ? `${state.user.email}${isAdmin()?' · 관리자':''}` : '로그인하지 않음';
}

async function loadRestaurants(){
  const {data,error}=await db.from('restaurants').select('*').order('name');
  if(error){console.error(error);$('#list').innerHTML='<div class="empty">식당 정보를 불러오지 못했어요. Supabase 설정/RLS를 확인해주세요.</div>';return;}
  state.restaurants=data||[];renderList();plotMarkers();
}
function renderList(){
  if(!state.restaurants.length){$('#list').innerHTML='<div class="empty">아직 등록된 식당이 없어요.</div>';return;}
  $('#list').innerHTML=state.restaurants.map(r=>`<div class="food-card" data-id="${r.id}"><div><h3>${escapeHtml(r.name)}</h3><span class="chip">🚶 ${r.walk_min??'?'}분</span><span class="chip">${escapeHtml(r.menu||'메뉴 미등록')}</span></div><span>›</span></div>`).join('');
  $$('.food-card').forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
}

async function openDetail(id){
  const r=state.restaurants.find(x=>String(x.id)===String(id));if(!r)return;
  const {data:reviews}=await db.from('reviews').select('id,rating,content,author_name,created_at').eq('restaurant_id',r.id).order('created_at',{ascending:false});

  const reviewFormHtml = `
    <div class="form-actions">
      <input id="reviewAuthor" placeholder="이름 (선택)" style="flex:1">
      <select id="reviewRating">
        <option value="5">★★★★★</option><option value="4">★★★★☆</option>
        <option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option>
      </select>
    </div>
    <textarea id="reviewContent" rows="3" placeholder="먹어본 후기를 남겨주세요."></textarea>
    <div class="form-actions"><button class="btn primary" id="reviewSubmit">리뷰 등록</button></div>`;

  $('#detailSheet').innerHTML=`<button class="close-x" id="detailClose">✕</button><h2>${escapeHtml(r.name)}</h2>
    <div class="row"><span class="chip">🚶 도보 ${r.walk_min??'?'}분</span>${r.phone?`<span class="chip">☎ ${escapeHtml(r.phone)}</span>`:''}</div>
    <p style="color:#6b6551;font-size:.9rem">${escapeHtml(r.address)}</p>
    <p><strong>대표메뉴</strong><br>${escapeHtml(r.menu||'미등록')}</p>
    <div class="links">${r.naver_url?`<a class="link-naver" href="${escapeHtml(r.naver_url)}" target="_blank" rel="noopener">네이버지도</a>`:''}${r.kakao_url?`<a class="link-kakao" href="${escapeHtml(r.kakao_url)}" target="_blank" rel="noopener">카카오맵</a>`:''}</div>
    ${isAdmin()?'<div class="form-actions"><button class="btn" id="editThisBtn">수정</button></div>':''}
    <div class="review-form"><strong>리뷰</strong>${reviewFormHtml}</div>
    <div id="reviews">${(reviews||[]).map(v=>`<div class="review"><strong>${'★'.repeat(v.rating)}${'☆'.repeat(5-v.rating)}</strong>${v.author_name?` <span class="hint">- ${escapeHtml(v.author_name)}</span>`:''}<p>${escapeHtml(v.content)}</p></div>`).join('')||'<p class="hint">아직 리뷰가 없어요.</p>'}</div>`;

  show('#detailOverlay');$('#detailClose').onclick=()=>hide('#detailOverlay');
  if(isAdmin())$('#editThisBtn').onclick=()=>{hide('#detailOverlay');openForm(r)};
  $('#reviewSubmit').onclick=()=>submitReview(r.id);
}

async function submitReview(restaurantId){
  const content = $('#reviewContent').value.trim();
  const rating = Number($('#reviewRating').value);
  const authorName = $('#reviewAuthor').value.trim() || null;
  if(!content) return alert('리뷰 내용을 입력해주세요.');
  const { error } = await db.from('reviews').insert({ restaurant_id: restaurantId, rating, content, author_name: authorName });
  if(error) alert('리뷰 등록 실패: ' + error.message);
  else openDetail(restaurantId);
}

function openForm(existing=null){
  if(!isAdmin())return alert('관리자만 식당 정보를 관리할 수 있어요.');
  state.editingId=existing?.id||null;state.lastGeocode=existing?.lat?{lat:existing.lat,lng:existing.lng}:null;$('#formTitle').textContent=existing?'식당 수정':'식당 추가';$('#foodForm').reset();
  if(existing){const f=$('#foodForm');f.name.value=existing.name;f.address.value=existing.address;f.walkMin.value=existing.walk_min??'';f.menu.value=existing.menu||'';f.phone.value=existing.phone||'';f.naverUrl.value=existing.naver_url||'';f.kakaoUrl.value=existing.kakao_url||'';$('#deleteBtn').hidden=false;$('#geoStatus').textContent=existing.lat?'위치 저장됨':'';}else{$('#deleteBtn').hidden=true;$('#geoStatus').textContent='';}show('#formOverlay');
}
$('#addBtn').onclick=()=>openForm();$('#formClose').onclick=()=>hide('#formOverlay');
$('#geocodeBtn').onclick=async()=>{const addr=$('#foodForm').address.value.trim();if(!addr)return $('#geoStatus').textContent='주소를 먼저 입력해주세요.';$('#geoStatus').textContent='찾는 중...';try{state.lastGeocode=await geocodeAddress(addr);$('#geoStatus').textContent='위치를 찾았어요.'}catch(e){$('#geoStatus').textContent='위치를 찾지 못했어요.'}};
$('#foodForm').onsubmit=async e=>{e.preventDefault();if(!isAdmin())return;const f=e.target,coord=state.lastGeocode;const payload={name:f.name.value.trim(),address:f.address.value.trim(),walk_min:f.walkMin.value?Number(f.walkMin.value):null,menu:f.menu.value.trim()||null,phone:f.phone.value.trim()||null,naver_url:f.naverUrl.value.trim()||null,kakao_url:f.kakaoUrl.value.trim()||null,lat:coord?.lat??null,lng:coord?.lng??null};let result;if(state.editingId)result=await db.from('restaurants').update(payload).eq('id',state.editingId);else result=await db.from('restaurants').insert(payload);if(result.error)return alert(result.error.message);hide('#formOverlay');await loadRestaurants()};
$('#deleteBtn').onclick=async()=>{if(!state.editingId||!confirm('이 식당을 삭제할까요?'))return;const {error}=await db.from('restaurants').delete().eq('id',state.editingId);if(error)alert(error.message);else{hide('#formOverlay');await loadRestaurants()}};

function loadKakaoMap(){
  kakao.maps.load(()=>{const center=ACADEMY.lat&&ACADEMY.lng?new kakao.maps.LatLng(ACADEMY.lat,ACADEMY.lng):new kakao.maps.LatLng(37.5665,126.978);state.map=new kakao.maps.Map($('#map'),{center,level:4});$('#mapNote').textContent='카카오맵';plotMarkers()});
}
function clearMarkers(){state.markers.forEach(m=>m.setMap(null));state.markers=[]}
function plotMarkers(){if(!state.map||!window.kakao)return;clearMarkers();const rows=state.restaurants.filter(r=>r.lat!=null&&r.lng!=null);const bounds=new kakao.maps.LatLngBounds();rows.forEach(r=>{const pos=new kakao.maps.LatLng(r.lat,r.lng),m=new kakao.maps.Marker({position:pos,map:state.map});kakao.maps.event.addListener(m,'click',()=>openDetail(r.id));state.markers.push(m);bounds.extend(pos)});if(rows.length)state.map.setBounds(bounds)}
function geocodeAddress(address){return new Promise((resolve,reject)=>{if(!window.kakao?.maps?.services)return reject('no sdk');const geocoder=new kakao.maps.services.Geocoder();geocoder.addressSearch(address,(result,status)=>{if(status===kakao.maps.services.Status.OK)resolve({lat:parseFloat(result[0].y),lng:parseFloat(result[0].x)});else reject(status)})})}

$('#loginBtn').onclick=()=>show('#authOverlay');$('#authClose').onclick=()=>hide('#authOverlay');
$('#authForm').onsubmit=async e=>{e.preventDefault();const email=$('#email').value.trim(),password=$('#password').value;const {error}=await db.auth.signInWithPassword({email,password});$('#authMessage').textContent=error?error.message:'로그인되었습니다.';if(!error)hide('#authOverlay')};
$('#logoutBtn').onclick=async()=>{await db.auth.signOut()};

init();