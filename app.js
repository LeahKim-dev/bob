/* =========================
   오늘 뭐 먹지? - Supabase + Kakao
   (관리자 로그인=식당 관리, 리뷰는 누구나)
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
const state = { user:null, profile:null, restaurants:[], ratings:{}, categoryFilter:'all', map:null, markers:[], editingId:null, lastGeocode:null };
let formImages = { kept:[], pendingFiles:[] };

function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isAdmin(){return state.profile?.role==='admin';}
function show(id){$(id).classList.add('open')}
function hide(id){$(id).classList.remove('open')}
function ratingAvg(r){ const s=state.ratings[r.id]; return s ? s.avg : null; }
function ratingCount(r){ const s=state.ratings[r.id]; return s ? s.count : 0; }
function starsText(avg){ if(avg==null) return '평점 없음'; const n=Math.round(avg); return '★'.repeat(n)+'☆'.repeat(5-n); }

async function init(){
  await loadSession();
  db.auth.onAuthStateChange(async (_event, session)=>{
    state.user=session?.user||null;
    await loadProfile();
    updateAuthUI(); renderList();
  });
  loadKakaoMap();
  $('#sortSelect')?.addEventListener('change', renderList);
  $$('.cat-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.categoryFilter = btn.dataset.cat;
      $$('.cat-pill').forEach(b=>b.classList.toggle('active', b===btn));
      renderList(); plotMarkers();
    });
  });
}

async function loadSession(){
  const {data}=await db.auth.getSession();
  state.user=data.session?.user||null;
  await loadProfile();
  updateAuthUI(); await loadRestaurants(); await loadRatings();
}
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
  if(state.categoryFilter && state.categoryFilter!=='all'){
    list=list.filter(r=>(r.category||'기타')===state.categoryFilter);
  }
  const sort=$('#sortSelect')?.value;
  if(sort==='walk') list.sort((a,b)=>(a.walk_min ?? 999)-(b.walk_min ?? 999));
  else list.sort((a,b)=>(ratingAvg(b)??-1)-(ratingAvg(a)??-1)); // 기본: 별점순
  return list;
}

function renderList(){
  const list=getVisibleRestaurants();
  if(!list.length){$('#list').innerHTML='<div class="empty">표시할 식당이 없어요.</div>';return;}
  $('#list').innerHTML=list.map(r=>{
    const avg=ratingAvg(r);
    return `<div class="food-card" data-id="${r.id}">
      <div>
        <h3><span class="cat-badge" style="background:${categoryColor(r.category)}"></span>${escapeHtml(r.name)}</h3>
        <span class="chip">🚶 ${r.walk_min??'?'}분</span>
        <span class="chip">${escapeHtml(r.category||'기타')}</span>
        <span class="chip">⭐ ${avg? avg.toFixed(1)+' ('+ratingCount(r)+')' : '평점 없음'}</span>
      </div>
      <span>›</span>
    </div>`;
  }).join('');
  $$('.food-card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));
}

function openLightbox(url){
  $('#lightboxImg').src = url;
  show('#imageLightbox');
}
window.openLightbox = openLightbox;

async function openDetail(id){
  const r=state.restaurants.find(x=>String(x.id)===String(id));if(!r)return;
  const {data:reviews}=await db.from('reviews').select('id,rating,content,author_name,created_at').eq('restaurant_id',r.id).order('created_at',{ascending:false});
  const avg=ratingAvg(r);

  const reviewFormHtml = `
    <div class="star-picker-static" style="display:inline-flex;font-size:1.4rem;letter-spacing:2px;cursor:pointer;vertical-align:middle;">
      ${[1,2,3,4,5].map(n=>`<span data-star="${n}" style="color:#D8CBA8;">★</span>`).join('')}
    </div>`;

  const routeLinks = (r.lat!=null && r.lng!=null && ACADEMY.lat!=null && ACADEMY.lng!=null) ? `
    <div class="links" style="display:flex;gap:0;align-items:center;margin-top:2px;">
      <a target="_blank" rel="noopener" title="카카오맵 길찾기 (도보)"
         href="http://m.map.kakao.com/scheme/route?sp=${ACADEMY.lat},${ACADEMY.lng}&ep=${r.lat},${r.lng}&by=foot"
         style="flex:none;padding:0;position:relative;display:block;border-radius:0;">
        <img src="kakao-icon.svg" style="width:32px;height:32px;border-radius:8px 0 0 8px;object-fit:cover;display:block;">
        <span style="position:absolute;bottom:-4px;right:-4px;background:#fff;border-radius:6px;font-size:10px;line-height:1;padding:1px 2px;box-shadow:0 1px 2px rgba(0,0,0,.3);">🚶</span>
      </a>
      <a target="_blank" rel="noopener" title="네이버지도 길찾기 (도보)"
         href="nmap://route/walk?slat=${ACADEMY.lat}&slng=${ACADEMY.lng}&sname=${encodeURIComponent(ACADEMY.name||'학원')}&dlat=${r.lat}&dlng=${r.lng}&dname=${encodeURIComponent(r.name)}&appname=${encodeURIComponent(location.href)}"
         style="flex:none;padding:0;position:relative;display:block;border-radius:0;">
        <img src="naver-icon.webp" style="width:32px;height:32px;border-radius:0 8px 8px 0;object-fit:cover;display:block;">
        <span style="position:absolute;bottom:-4px;right:-4px;background:#fff;border-radius:6px;font-size:10px;line-height:1;padding:1px 2px;box-shadow:0 1px 2px rgba(0,0,0,.3);">🚶</span>
      </a>
    </div>` : '';

  const images = (r.image_urls && r.image_urls.length) ? r.image_urls : (r.image_url ? [r.image_url] : []);
  const galleryHtml = images.length ? `
    <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;">
      ${images.map(url=>`<img src="${escapeHtml(url)}" style="width:100px;height:100px;object-fit:cover;border-radius:10px;cursor:zoom-in;flex-shrink:0;" onclick="window.openLightbox('${escapeHtml(url)}')">`).join('')}
    </div>` : '';

  $('#detailSheet').innerHTML=`<button class="close-x" id="detailClose">✕</button>
    ${galleryHtml}
    <h2><span class="cat-badge" style="background:${categoryColor(r.category)}"></span>${escapeHtml(r.name)}</h2>
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
    <p><strong>대표메뉴</strong><br>${escapeHtml(r.menu||'미등록')}</p>
    <div class="links" style="display:flex;gap:0;align-items:center;">
      ${r.naver_url?`<a href="${escapeHtml(r.naver_url)}" target="_blank" rel="noopener" title="네이버지도에서 보기" style="flex:none;padding:0;display:block;border-radius:0;">
         <img src="naver-icon.webp" style="width:32px;height:32px;border-radius:8px 0 0 8px;object-fit:cover;display:block;"></a>`:''}
      ${r.kakao_url?`<a href="${escapeHtml(r.kakao_url)}" target="_blank" rel="noopener" title="카카오맵에서 보기" style="flex:none;padding:0;display:block;border-radius:0;">
         <img src="kakao-icon.svg" style="width:32px;height:32px;border-radius:0 8px 8px 0;object-fit:cover;display:block;"></a>`:''}
    </div>
    ${routeLinks}
    ${isAdmin()?'<div class="form-actions"><button class="btn" id="editThisBtn">수정</button></div>':''}
    <div class="review-form" style="display:flex;align-items:center;gap:10px;"><strong>리뷰</strong>${reviewFormHtml}</div>
    <div id="reviews">${(reviews||[]).map(v=>`<div class="review"><strong>${'★'.repeat(v.rating)}${'☆'.repeat(5-v.rating)}</strong>${v.author_name?` <span class="hint">- ${escapeHtml(v.author_name)}</span>`:''}<p>${escapeHtml(v.content)}</p></div>`).join('')||'<p class="hint">아직 리뷰가 없어요.</p>'}</div>`;

  show('#detailOverlay');$('#detailClose').onclick=()=>hide('#detailOverlay');
  if(isAdmin())$('#editThisBtn').onclick=()=>{hide('#detailOverlay');openForm(r)};
  $$('.star-picker-static span').forEach(s=>{
    s.addEventListener('click', ()=> openReviewPopup(r.id, Number(s.dataset.star)));
  });
}

function openReviewPopup(restaurantId, initialRating){
  let picked = initialRating;
  $('#reviewSheet').innerHTML = `
    <button class="close-x" id="reviewPopupClose">✕</button>
    <h2>리뷰 남기기</h2>
    <div class="star-picker" id="reviewPopupStars" style="font-size:1.8rem; letter-spacing:4px; cursor:pointer;">
      ${[1,2,3,4,5].map(n=>`<span data-star="${n}" style="color:${n<=picked?'#D9A441':'#D8CBA8'};">★</span>`).join('')}
    </div>
    <label>닉네임 (선택)</label>
    <input id="popupAuthor" placeholder="예: 익명의 새싹">
    <label>후기</label>
    <textarea id="popupContent" rows="4" placeholder="먹어본 후기를 남겨주세요."></textarea>
    <div class="form-actions"><button class="btn primary grow" id="popupSubmit">등록</button></div>`;

  $$('#reviewPopupStars span').forEach(s=>{
    s.addEventListener('click', ()=>{
      picked = Number(s.dataset.star);
      $$('#reviewPopupStars span').forEach(x=> x.style.color = Number(x.dataset.star)<=picked ? '#D9A441' : '#D8CBA8');
    });
  });
  $('#reviewPopupClose').onclick = ()=> hide('#reviewOverlay');
  $('#popupSubmit').onclick = async ()=>{
    const content = $('#popupContent').value.trim();
    if(!content) return alert('후기 내용을 입력해주세요.');
    const authorName = $('#popupAuthor').value.trim() || null;
    const { error } = await db.from('reviews').insert({ restaurant_id: restaurantId, rating: picked, content, author_name: authorName });
    if(error){ alert('리뷰 등록 실패: ' + error.message); return; }
    hide('#reviewOverlay');
    await loadRatings();
    openDetail(restaurantId);
  };
  show('#reviewOverlay');
}

function renderImagePreview(){
  const box = $('#imagePreviewList');
  const thumbs = [];
  formImages.kept.forEach((url, i)=>{
    thumbs.push(`<div style="position:relative;">
      <img src="${url}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;">
      <button type="button" data-kept="${i}" style="position:absolute;top:-6px;right:-6px;background:#b3413c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;">✕</button>
    </div>`);
  });
  formImages.pendingFiles.forEach((item, i)=>{
    thumbs.push(`<div style="position:relative;">
      <img src="${item.preview}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;opacity:.85;">
      <button type="button" data-pending="${i}" style="position:absolute;top:-6px;right:-6px;background:#b3413c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;">✕</button>
    </div>`);
  });
  box.innerHTML = thumbs.join('');
  $$('button[data-kept]', box).forEach(btn=>btn.onclick=()=>{ formImages.kept.splice(Number(btn.dataset.kept),1); renderImagePreview(); });
  $$('button[data-pending]', box).forEach(btn=>btn.onclick=()=>{ formImages.pendingFiles.splice(Number(btn.dataset.pending),1); renderImagePreview(); });
}

function openForm(existing=null){
  if(!isAdmin())return alert('관리자만 식당 정보를 관리할 수 있어요.');
  state.editingId=existing?.id||null;state.lastGeocode=existing?.lat?{lat:existing.lat,lng:existing.lng}:null;$('#formTitle').textContent=existing?'식당 수정':'식당 추가';$('#foodForm').reset();
  formImages = { kept: existing ? (existing.image_urls && existing.image_urls.length ? [...existing.image_urls] : (existing.image_url ? [existing.image_url] : [])) : [], pendingFiles: [] };
  renderImagePreview();
  if(existing){
    const f=$('#foodForm');
    f.name.value=existing.name;f.address.value=existing.address;
    if(f.category) f.category.value=existing.category||'기타';
    f.walkMin.value=existing.walk_min??'';f.menu.value=existing.menu||'';
    if(f.hours) f.hours.value=existing.hours||'';
    f.phone.value=existing.phone||'';
    f.naverUrl.value=existing.naver_url||'';f.kakaoUrl.value=existing.kakao_url||'';
    $('#deleteBtn').hidden=false;$('#geoStatus').textContent=existing.lat?'위치 저장됨':'';
  }else{$('#deleteBtn').hidden=true;$('#geoStatus').textContent='';}
  show('#formOverlay');
}
$('#addBtn').onclick=()=>openForm();$('#formClose').onclick=()=>hide('#formOverlay');
const imageFileInput = $('#foodForm input[name="imageFiles"]');
imageFileInput?.addEventListener('change', (e)=>{
  const files=[...e.target.files];
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=()=>{
      formImages.pendingFiles.push({ file, preview: reader.result });
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  });
  e.target.value=''; // 같은 파일 다시 선택 가능하게 초기화
});
$('#geocodeBtn').onclick=async()=>{const f=$('#foodForm');const addr=f.address.value.trim();const name=f.name.value.trim();if(!addr)return $('#geoStatus').textContent='주소를 먼저 입력해주세요.';$('#geoStatus').textContent='찾는 중...';try{state.lastGeocode=await geocodeAddress(addr,name);$('#geoStatus').textContent='위치를 찾았어요.'}catch(e){$('#geoStatus').textContent='위치를 찾지 못했어요.'}};
$('#foodForm').onsubmit=async e=>{
  e.preventDefault();if(!isAdmin())return;
  const f=e.target,coord=state.lastGeocode;
  const submitBtn=f.querySelector('button[type=submit]');
  submitBtn.disabled=true; submitBtn.textContent='저장 중...';

  const uploadedUrls=[];
  for(const item of formImages.pendingFiles){
    const file=item.file;
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await db.storage.from('restaurant-images').upload(path, file, { upsert:false });
    if(upErr){
      alert('이미지 업로드 실패: ' + upErr.message);
      submitBtn.disabled=false; submitBtn.textContent='저장';
      return;
    }
    const { data: pub } = db.storage.from('restaurant-images').getPublicUrl(path);
    uploadedUrls.push(pub.publicUrl);
  }
  const finalImageUrls = [...formImages.kept, ...uploadedUrls];

  const payload={
    name:f.name.value.trim(),address:f.address.value.trim(),
    category:f.category?f.category.value:null,
    walk_min:f.walkMin.value?Number(f.walkMin.value):null,
    menu:f.menu.value.trim()||null,
    hours:f.hours?f.hours.value.trim()||null:null,
    phone:f.phone.value.trim()||null,
    image_urls: finalImageUrls.length ? finalImageUrls : null,
    image_url: finalImageUrls[0] || null,
    naver_url:f.naverUrl.value.trim()||null,kakao_url:f.kakaoUrl.value.trim()||null,
    lat:coord?.lat??null,lng:coord?.lng??null
  };
  let result;
  if(state.editingId)result=await db.from('restaurants').update(payload).eq('id',state.editingId);
  else result=await db.from('restaurants').insert(payload);
  submitBtn.disabled=false; submitBtn.textContent='저장';
  if(result.error)return alert(result.error.message);
  hide('#formOverlay');await loadRestaurants()
};
$('#deleteBtn').onclick=async()=>{if(!state.editingId||!confirm('이 식당을 삭제할까요?'))return;const {error}=await db.from('restaurants').delete().eq('id',state.editingId);if(error)alert(error.message);else{hide('#formOverlay');await loadRestaurants()}};

function loadKakaoMap(){
  kakao.maps.load(()=>{const center=ACADEMY.lat&&ACADEMY.lng?new kakao.maps.LatLng(ACADEMY.lat,ACADEMY.lng):new kakao.maps.LatLng(37.5665,126.978);state.map=new kakao.maps.Map($('#map'),{center,level:4});$('#mapNote').textContent='카카오맵';plotMarkers()});
}
function spreadOverlapping(rows){
  const groups={};
  rows.forEach(r=>{
    const key=r.lat.toFixed(5)+','+r.lng.toFixed(5);
    (groups[key]=groups[key]||[]).push(r);
  });
  Object.values(groups).forEach(group=>{
    if(group.length<2) return;
    const radius=0.00012; // 약 12~13m 정도 반경으로 원형 배치
    group.forEach((r,i)=>{
      const angle=(2*Math.PI*i)/group.length;
      r._plotLat = r.lat + radius*Math.cos(angle);
      r._plotLng = r.lng + radius*Math.sin(angle)/Math.cos(r.lat*Math.PI/180);
    });
  });
  return rows;
}

function clearMarkers(){state.markers.forEach(m=>m.setMap(null));state.markers=[]}
function plotMarkers(){
  if(!state.map||!window.kakao)return;
  clearMarkers();
  let rows=state.restaurants.filter(r=>r.lat!=null&&r.lng!=null);
  if(state.categoryFilter && state.categoryFilter!=='all'){
    rows=rows.filter(r=>(r.category||'기타')===state.categoryFilter);
  }
  rows=spreadOverlapping(rows);
  const bounds=new kakao.maps.LatLngBounds();
  rows.forEach(r=>{
    const plat=r._plotLat ?? r.lat, plng=r._plotLng ?? r.lng;
    const pos=new kakao.maps.LatLng(plat,plng);
    const m=new kakao.maps.Marker({position:pos,map:state.map});
    kakao.maps.event.addListener(m,'click',()=>openDetail(r.id));
    state.markers.push(m);

    const color=categoryColor(r.category);
    const label=new kakao.maps.CustomOverlay({
      position:pos,
      yAnchor:2.2,
      content:`<div onclick="window.openDetail('${r.id}')" style="padding:2px 8px;background:${color};color:#fff;border-radius:6px;font-size:12px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;">${escapeHtml(r.name)}</div>`
    });
    label.setMap(state.map);
    state.markers.push(label);

    bounds.extend(pos);
  });
  if(rows.length)state.map.setBounds(bounds);
}
function geocodeAddress(address, name){
  return new Promise((resolve,reject)=>{
    if(!window.kakao?.maps?.services) return reject('no sdk');
    const finish=(lat,lng)=>resolve({lat,lng});

    const fallbackToAddress=()=>{
      const geocoder=new kakao.maps.services.Geocoder();
      geocoder.addressSearch(address,(result,status)=>{
        if(status===kakao.maps.services.Status.OK) finish(parseFloat(result[0].y),parseFloat(result[0].x));
        else reject(status);
      });
    };

    // 상호명이 있으면 키워드 검색을 먼저 시도 (건물 내 개별 매장 좌표가 더 정확함)
    if(name && name.trim()){
      const places=new kakao.maps.services.Places();
      const centerOpt = (ACADEMY.lat!=null) ? { location: new kakao.maps.LatLng(ACADEMY.lat, ACADEMY.lng), radius: 3000 } : {};
      places.keywordSearch(`${name} ${address}`, (result, status)=>{
        if(status===kakao.maps.services.Status.OK && result.length){
          finish(parseFloat(result[0].y), parseFloat(result[0].x));
        } else {
          fallbackToAddress();
        }
      }, centerOpt);
    } else {
      fallbackToAddress();
    }
  });
}

$('#loginBtn').onclick=()=>show('#authOverlay');$('#authClose').onclick=()=>hide('#authOverlay');
$('#authForm').onsubmit=async e=>{e.preventDefault();const email=$('#email').value.trim(),password=$('#password').value;const {error}=await db.auth.signInWithPassword({email,password});$('#authMessage').textContent=error?error.message:'로그인되었습니다.';if(!error)hide('#authOverlay')};
$('#logoutBtn').onclick=async()=>{await db.auth.signOut()};

init();