/* =========================
   오늘 뭐 먹지? - Supabase + Kakao
   (관리자 로그인=식당 관리, 카카오 로그인=일반 사용자/찜, 리뷰는 누구나)
   ========================= */
const SUPABASE_URL = 'https://awutnyafwvdytgguuhjr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Kj8Yj4sHEMO7vtgHaBQf1A_EwCptcFr';

// 학원 위치 (이미 설정해두셨던 좌표 그대로 유지하세요)
const ACADEMY = { name: '학원', lat: null, lng: null };

const CATEGORY_COLORS = {
  '한식':'#D9534F', '중식':'#F0AD4E', '일식':'#5BC0DE',
  '양식':'#9B59B6', '분식':'#E67E22', '카페/디저트':'#8B5E3C', '기타':'#7F8C8D'
};
function categoryColor(cat){ return CATEGORY_COLORS[cat] || CATEGORY_COLORS['기타']; }

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (s, root=document) => root.querySelector(s);
function $$(s, root=document){ return [...root.querySelectorAll(s)]; }
const state = { user:null, profile:null, restaurants:[], ratings:{}, favorites:new Set(), map:null, markers:[], editingId:null, lastGeocode:null };

function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isAdmin(){return state.profile?.role==='admin';}
function show(id){$(id).classList.add('open')}
function hide(id){$(id).classList.remove('open')}
function ratingAvg(r){ const s=state.ratings[r.id]; return s ? s.avg : null; }
function ratingCount(r){ const s=state.ratings[r.id]; return s ? s.count : 0; }
function starsText(avg){ if(avg==null) return '평점 없음'; const n=Math.round(avg); return '★'.repeat(n)+'☆'.repeat(5-n); }
function haversine(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function distFromAcademy(r){
  if(ACADEMY.lat==null||r.lat==null) return Infinity;
  return haversine(ACADEMY.lat,ACADEMY.lng,r.lat,r.lng);
}

async function init(){
  await loadSession();
  db.auth.onAuthStateChange(async (_event, session)=>{
    state.user=session?.user||null;
    await loadProfile(); await loadFavorites();
    updateAuthUI(); renderList();
  });
  loadKakaoMap();
  $('#sortSelect')?.addEventListener('change', renderList);
  $('#favOnlyCheck')?.addEventListener('change', renderList);
}

async function loadSession(){
  const {data}=await db.auth.getSession();
  state.user=data.session?.user||null;
  await loadProfile(); await loadFavorites();
  updateAuthUI(); await loadRestaurants(); await loadRatings();
}
async function loadProfile(){
  state.profile=null;if(!state.user)return;
  const {data,error}=await db.from('profiles').select('id,role').eq('id',state.user.id).maybeSingle();
  if(!error) state.profile=data;
}
async function loadFavorites(){
  state.favorites=new Set();
  if(!state.user) return;
  const {data,error}=await db.from('favorites').select('restaurant_id').eq('user_id',state.user.id);
  if(!error) (data||[]).forEach(f=>state.favorites.add(f.restaurant_id));
}
function updateAuthUI(){
  $('#loginBtn').hidden=!!state.user;$('#logoutBtn').hidden=!state.user;$('#addBtn').hidden=!isAdmin();
  $('#authStatus').textContent=state.user ? `${state.user.email||state.user.user_metadata?.name||'로그인됨'}${isAdmin()?' · 관리자':''}` : '로그인하지 않음';
}

async function loadRestaurants(){
  const {data,error}=await db.from('restaurants').select('*').order('name');
  if(error){console.error(error);$('#list').innerHTML='<div class="empty">식당 정보를 불러오지 못했어요. Supabase 설정/RLS를 확인해주세요.</div>';return;}
  state.restaurants=data||[];renderList();plotMarkers();
}
async function loadRatings(){
  const {data,error}=await db.from('reviews').select('restaurant_id,rating');
  state.ratings={};
  if(error) return;
  const sums={};
  (data||[]).forEach(v=>{
    if(!sums[v.restaurant_id]) sums[v.restaurant_id]={sum:0,count:0};
    sums[v.restaurant_id].sum+=v.rating; sums[v.restaurant_id].count++;
  });
  Object.keys(sums).forEach(id=>{ state.ratings[id]={ avg: sums[id].sum/sums[id].count, count: sums[id].count }; });
  renderList();
}

function getVisibleRestaurants(){
  let list=[...state.restaurants];
  if($('#favOnlyCheck')?.checked) list=list.filter(r=>state.favorites.has(r.id));
  const sort=$('#sortSelect')?.value;
  if(sort==='rating') list.sort((a,b)=>(ratingAvg(b)??-1)-(ratingAvg(a)??-1));
  else if(sort==='distance') list.sort((a,b)=>distFromAcademy(a)-distFromAcademy(b));
  return list;
}

function renderList(){
  const list=getVisibleRestaurants();
  if(!list.length){$('#list').innerHTML='<div class="empty">표시할 식당이 없어요.</div>';return;}
  $('#list').innerHTML=list.map(r=>{
    const avg=ratingAvg(r);
    const isFav=state.favorites.has(r.id);
    return `<div class="food-card" data-id="${r.id}">
      <div>
        <h3><span class="cat-badge" style="background:${categoryColor(r.category)}"></span>${escapeHtml(r.name)}</h3>
        <span class="chip">🚶 ${r.walk_min??'?'}분</span>
        <span class="chip">${escapeHtml(r.menu||'메뉴 미등록')}</span>
        <span class="chip">⭐ ${avg? avg.toFixed(1)+' ('+ratingCount(r)+')' : '평점 없음'}</span>
      </div>
      <button class="fav-btn" data-fav="${r.id}">${isFav?'❤️':'🤍'}</button>
    </div>`;
  }).join('');
  $$('.food-card').forEach(el=>el.addEventListener('click',(e)=>{
    if(e.target.closest('.fav-btn')) return;
    openDetail(el.dataset.id);
  }));
  $$('.fav-btn').forEach(btn=>btn.addEventListener('click',(e)=>{
    e.stopPropagation(); toggleFavorite(Number(btn.dataset.fav));
  }));
}

async function toggleFavorite(restaurantId){
  if(!state.user){ alert('찜하려면 카카오 로그인이 필요해요.'); show('#authOverlay'); return; }
  if(state.favorites.has(restaurantId)){
    await db.from('favorites').delete().eq('user_id',state.user.id).eq('restaurant_id',restaurantId);
    state.favorites.delete(restaurantId);
  }else{
    await db.from('favorites').insert({user_id:state.user.id, restaurant_id:restaurantId});
    state.favorites.add(restaurantId);
  }
  renderList();
}

async function openDetail(id){
  const r=state.restaurants.find(x=>String(x.id)===String(id));if(!r)return;
  const {data:reviews}=await db.from('reviews').select('id,rating,content,author_name,created_at').eq('restaurant_id',r.id).order('created_at',{ascending:false});
  const avg=ratingAvg(r);
  const isFav=state.favorites.has(r.id);

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

  const routeLinks = (r.lat!=null && r.lng!=null && ACADEMY.lat!=null && ACADEMY.lng!=null) ? `
    <div class="links" style="margin-top:6px;">
      <a class="link-kakao" target="_blank" rel="noopener"
         href="http://m.map.kakao.com/scheme/route?sp=${ACADEMY.lat},${ACADEMY.lng}&ep=${r.lat},${r.lng}&by=foot">카카오맵 길찾기</a>
      <a class="link-naver" target="_blank" rel="noopener"
         href="nmap://route/walk?slat=${ACADEMY.lat}&slng=${ACADEMY.lng}&sname=${encodeURIComponent(ACADEMY.name||'학원')}&dlat=${r.lat}&dlng=${r.lng}&dname=${encodeURIComponent(r.name)}&appname=${encodeURIComponent(location.href)}">네이버지도 길찾기</a>
    </div>` : '';

  $('#detailSheet').innerHTML=`<button class="close-x" id="detailClose">✕</button>
    ${r.image_url?`<img class="detail-image" src="${escapeHtml(r.image_url)}" alt="${escapeHtml(r.name)}">`:''}
    <h2><span class="cat-badge" style="background:${categoryColor(r.category)}"></span>${escapeHtml(r.name)}
      <button class="fav-btn" id="detailFavBtn" style="float:right;">${isFav?'❤️':'🤍'}</button>
    </h2>
    <div class="row" style="align-items:center;">
      <span>${starsText(avg)}</span>
      <span class="hint">${avg? avg.toFixed(1)+' / 5 · '+ratingCount(r)+'명 평가' : '아직 평점 없음'}</span>
    </div>
    <div class="row">
      <span class="chip">🚶 도보 ${r.walk_min??'?'}분</span>
      ${r.category?`<span class="chip">${escapeHtml(r.category)}</span>`:''}
      ${r.phone?`<span class="chip"><a href="tel:${escapeHtml(r.phone.replace(/[^0-9+]/g,''))}" style="color:inherit;text-decoration:none;">☎ ${escapeHtml(r.phone)}</a></span>`:''}
    </div>
    ${r.hours?`<p><strong>영업시간</strong><br>${escapeHtml(r.hours)}</p>`:''}
    <p style="color:#6b6551;font-size:.9rem">${escapeHtml(r.address)}</p>
    <p><strong>대표메뉴</strong><br>${escapeHtml(r.menu||'미등록')}</p>
    <div class="links">${r.naver_url?`<a class="link-naver" href="${escapeHtml(r.naver_url)}" target="_blank" rel="noopener">네이버지도</a>`:''}${r.kakao_url?`<a class="link-kakao" href="${escapeHtml(r.kakao_url)}" target="_blank" rel="noopener">카카오맵</a>`:''}</div>
    ${routeLinks}
    ${isAdmin()?'<div class="form-actions"><button class="btn" id="editThisBtn">수정</button></div>':''}
    <div class="review-form"><strong>리뷰</strong>${reviewFormHtml}</div>
    <div id="reviews">${(reviews||[]).map(v=>`<div class="review"><strong>${'★'.repeat(v.rating)}${'☆'.repeat(5-v.rating)}</strong>${v.author_name?` <span class="hint">- ${escapeHtml(v.author_name)}</span>`:''}<p>${escapeHtml(v.content)}</p></div>`).join('')||'<p class="hint">아직 리뷰가 없어요.</p>'}</div>`;

  show('#detailOverlay');$('#detailClose').onclick=()=>hide('#detailOverlay');
  if(isAdmin())$('#editThisBtn').onclick=()=>{hide('#detailOverlay');openForm(r)};
  $('#reviewSubmit').onclick=()=>submitReview(r.id);
  $('#detailFavBtn').onclick=()=>toggleFavorite(r.id).then(()=>openDetail(r.id));
}

async function submitReview(restaurantId){
  const content = $('#reviewContent').value.trim();
  const rating = Number($('#reviewRating').value);
  const authorName = $('#reviewAuthor').value.trim() || null;
  if(!content) return alert('리뷰 내용을 입력해주세요.');
  const { error } = await db.from('reviews').insert({ restaurant_id: restaurantId, rating, content, author_name: authorName });
  if(error) alert('리뷰 등록 실패: ' + error.message);
  else { await loadRatings(); openDetail(restaurantId); }
}

function openForm(existing=null){
  if(!isAdmin())return alert('관리자만 식당 정보를 관리할 수 있어요.');
  state.editingId=existing?.id||null;state.lastGeocode=existing?.lat?{lat:existing.lat,lng:existing.lng}:null;$('#formTitle').textContent=existing?'식당 수정':'식당 추가';$('#foodForm').reset();
  if(existing){
    const f=$('#foodForm');
    f.name.value=existing.name;f.address.value=existing.address;
    if(f.category) f.category.value=existing.category||'기타';
    f.walkMin.value=existing.walk_min??'';f.menu.value=existing.menu||'';
    if(f.hours) f.hours.value=existing.hours||'';
    f.phone.value=existing.phone||'';
    if(f.imageUrl) f.imageUrl.value=existing.image_url||'';
    f.naverUrl.value=existing.naver_url||'';f.kakaoUrl.value=existing.kakao_url||'';
    $('#deleteBtn').hidden=false;$('#geoStatus').textContent=existing.lat?'위치 저장됨':'';
  }else{$('#deleteBtn').hidden=true;$('#geoStatus').textContent='';}
  show('#formOverlay');
}
$('#addBtn').onclick=()=>openForm();$('#formClose').onclick=()=>hide('#formOverlay');
$('#geocodeBtn').onclick=async()=>{const addr=$('#foodForm').address.value.trim();if(!addr)return $('#geoStatus').textContent='주소를 먼저 입력해주세요.';$('#geoStatus').textContent='찾는 중...';try{state.lastGeocode=await geocodeAddress(addr);$('#geoStatus').textContent='위치를 찾았어요.'}catch(e){$('#geoStatus').textContent='위치를 찾지 못했어요.'}};
$('#foodForm').onsubmit=async e=>{
  e.preventDefault();if(!isAdmin())return;
  const f=e.target,coord=state.lastGeocode;
  const payload={
    name:f.name.value.trim(),address:f.address.value.trim(),
    category:f.category?f.category.value:null,
    walk_min:f.walkMin.value?Number(f.walkMin.value):null,
    menu:f.menu.value.trim()||null,
    hours:f.hours?f.hours.value.trim()||null:null,
    phone:f.phone.value.trim()||null,
    image_url:f.imageUrl?f.imageUrl.value.trim()||null:null,
    naver_url:f.naverUrl.value.trim()||null,kakao_url:f.kakaoUrl.value.trim()||null,
    lat:coord?.lat??null,lng:coord?.lng??null
  };
  let result;
  if(state.editingId)result=await db.from('restaurants').update(payload).eq('id',state.editingId);
  else result=await db.from('restaurants').insert(payload);
  if(result.error)return alert(result.error.message);
  hide('#formOverlay');await loadRestaurants()
};
$('#deleteBtn').onclick=async()=>{if(!state.editingId||!confirm('이 식당을 삭제할까요?'))return;const {error}=await db.from('restaurants').delete().eq('id',state.editingId);if(error)alert(error.message);else{hide('#formOverlay');await loadRestaurants()}};

function loadKakaoMap(){
  kakao.maps.load(()=>{const center=ACADEMY.lat&&ACADEMY.lng?new kakao.maps.LatLng(ACADEMY.lat,ACADEMY.lng):new kakao.maps.LatLng(37.5665,126.978);state.map=new kakao.maps.Map($('#map'),{center,level:4});$('#mapNote').textContent='카카오맵';plotMarkers()});
}
function clearMarkers(){state.markers.forEach(m=>m.setMap(null));state.markers=[]}
function plotMarkers(){
  if(!state.map||!window.kakao)return;
  clearMarkers();
  const rows=state.restaurants.filter(r=>r.lat!=null&&r.lng!=null);
  const bounds=new kakao.maps.LatLngBounds();
  rows.forEach(r=>{
    const pos=new kakao.maps.LatLng(r.lat,r.lng);
    const m=new kakao.maps.Marker({position:pos,map:state.map});
    kakao.maps.event.addListener(m,'click',()=>openDetail(r.id));
    state.markers.push(m);

    const color=categoryColor(r.category);
    const label=new kakao.maps.CustomOverlay({
      position:pos,
      yAnchor:2.2,
      content:`<div style="padding:2px 8px;background:${color};color:#fff;border-radius:6px;font-size:12px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;">${escapeHtml(r.name)}</div>`
    });
    label.setMap(state.map);
    // 라벨 클릭도 상세보기로 연결
    kakao.maps.event.addListener(m,'click',()=>openDetail(r.id));
    state.markers.push(label);

    bounds.extend(pos);
  });
  if(rows.length)state.map.setBounds(bounds);
}
function geocodeAddress(address){return new Promise((resolve,reject)=>{if(!window.kakao?.maps?.services)return reject('no sdk');const geocoder=new kakao.maps.services.Geocoder();geocoder.addressSearch(address,(result,status)=>{if(status===kakao.maps.services.Status.OK)resolve({lat:parseFloat(result[0].y),lng:parseFloat(result[0].x)});else reject(status)})})}

$('#loginBtn').onclick=()=>show('#authOverlay');$('#authClose').onclick=()=>hide('#authOverlay');
$('#authForm').onsubmit=async e=>{e.preventDefault();const email=$('#email').value.trim(),password=$('#password').value;const {error}=await db.auth.signInWithPassword({email,password});$('#authMessage').textContent=error?error.message:'로그인되었습니다.';if(!error)hide('#authOverlay')};
$('#kakaoLoginBtn')?.addEventListener('click', async ()=>{
  const {error}=await db.auth.signInWithOAuth({provider:'kakao', options:{redirectTo: location.href}});
  if(error) $('#authMessage').textContent = error.message;
});
$('#logoutBtn').onclick=async()=>{await db.auth.signOut()};

init();