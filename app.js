/* ===== CONFIGURA ESTO ===== */
const SUPABASE_URL = 'https://qdzjnowiuxlkmoxlzmnh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkempub3dpdXhsa21veGx6bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NzQzMzUsImV4cCI6MjEwOTI1MDMzNX0.uSZKJPKFZVfht-GE7Dnqrs1sQcyGuqyt1PbMkVYbyuQ';
/* ========================== */

const DAILY = 5, PENALTY_MULT = 3, PER_COMPLAINT = 5;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);
const S = { user:null, g:[], c:[], norms:new Set(), mode:'login', open:null };

const ymd = d => { const z=new Date(d); return z.getFullYear()+'-'+String(z.getMonth()+1).padStart(2,'0')+'-'+String(z.getDate()).padStart(2,'0'); };
const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}\s]/gu,'').replace(/\s+/g,' ').trim();
const esc = t => t.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),3200);}

async function fetchAll(table, cols, order){
  let all=[], from=0;
  for(;;){
    const {data,error}=await sb.from(table).select(cols).order(order,{ascending:true}).range(from,from+999);
    if(error) throw error;
    all=all.concat(data); if(data.length<1000) break; from+=1000;
  }
  return all;
}

/* ---- Libro de cuentas: 5/día; día fallado => deuda = pendiente + 15 de castigo ---- */
function ledger(){
  const today = ymd(new Date());
  let start = ymd(S.user.created_at); if(start>today) start=today;
  const counts={};
  S.g.filter(x=>x.kind==='diaria').forEach(x=>counts[x.day]=(counts[x.day]||0)+1);
  let carry=0, missed=0, d=new Date(start+'T00:00:00');
  for(;;){
    const k=ymd(d), c=counts[k]||0, req=DAILY+carry;
    if(k>=today) return {req, done:c, missed, carry};
    if(c>=req) carry=0;
    else { const miss=c<DAILY; if(miss) missed++; carry=req-c+(miss?DAILY*(PENALTY_MULT):0); }
    d.setDate(d.getDate()+1);
  }
}

async function load(){
  try{
    S.g = await fetchAll('gratitudes','id,text,kind,complaint_id,day,created_at','created_at');
    S.c = await fetchAll('complaints','id,text,status,created_at','created_at');
  }catch(e){ return toast('Error al cargar: '+e.message); }
  S.norms = new Set(S.g.map(x=>norm(x.text)));
  render();
}

async function addGratitude(text, kind, cid){
  text=text.trim(); const n=norm(text);
  if(!n) return false;
  if(S.norms.has(n)){ toast('Esa gratitud ya existe. Busca una nueva 🌊'); return false; }
  const row={text, norm:n, kind, complaint_id:cid||null, day:ymd(new Date())};
  const {data,error}=await sb.from('gratitudes').insert(row).select('id,text,kind,complaint_id,day,created_at').single();
  if(error){ toast(error.code==='23505'?'Esa gratitud ya existe. Busca una nueva 🌊':error.message); return false; }
  S.g.push(data); S.norms.add(n);
  if(cid){
    const cnt=S.g.filter(x=>x.complaint_id===cid).length;
    if(cnt>=PER_COMPLAINT){
      const {error:e2}=await sb.from('complaints').update({status:'resuelta',resolved_at:new Date().toISOString()}).eq('id',cid);
      if(!e2){ const c=S.c.find(x=>x.id===cid); c.status='resuelta'; toast('Queja transformada en gratitud ✓'); }
    }
  }
  render(); return true;
}

async function addComplaint(text){
  text=text.trim(); if(!text) return;
  const {data,error}=await sb.from('complaints').insert({text}).select('id,text,status,created_at').single();
  if(error) return toast(error.message);
  S.c.push(data); S.open=data.id; render();
}

function render(){
  const L=ledger(), remain=Math.max(0,L.req-L.done), pct=Math.min(100,Math.round(L.done/L.req*100));
  $('#remain').innerHTML = remain? `Te faltan <span style="color:var(--sea)">${remain}</span> gratitudes hoy` : `<span class="ok">✓ Cuota de hoy completa</span>`;
  $('#barFill').style.width=pct+'%';
  $('#debtBox').innerHTML = L.carry>0
    ? `<div class="debt">Tienes <b>${L.missed}</b> día(s) fallado(s). Hoy debes <b>${L.req}</b> = 5 de hoy + <b>${L.carry}</b> de deuda (incluye castigo ×3).</div>` : '';

  const today=ymd(new Date());
  $('#gList').innerHTML = S.g.filter(x=>x.kind==='diaria'&&x.day===today).reverse()
    .map(x=>`<li class="g">🌱 ${esc(x.text)}</li>`).join('') || '<small>Aún no has escrito gratitudes hoy.</small>';

  const pend=S.c.filter(c=>c.status==='pendiente').reverse(), done=S.c.filter(c=>c.status==='resuelta').reverse();
  const card=c=>{
    const gs=S.g.filter(x=>x.complaint_id===c.id), isDone=c.status==='resuelta', open=S.open===c.id&&!isDone;
    return `<div class="q ${isDone?'done':''}">
      <div class="top"><div>${esc(c.text)}<div class="dots">${Array.from({length:PER_COMPLAINT},(_,i)=>`<b class="${i<gs.length?'on':''}"></b>`).join('')}</div></div>
      ${isDone?'<span class="chulo">✓</span>':`<button class="ghost" data-open="${c.id}">${open?'Cerrar':'Resolver'}</button>`}</div>
      ${gs.length?`<ul>${gs.map(x=>`<li class="g">💧 ${esc(x.text)}</li>`).join('')}</ul>`:''}
      ${open?`<div class="row" style="margin-top:8px"><input type="text" data-in="${c.id}" placeholder="Gratitud ${gs.length+1} de ${PER_COMPLAINT}…" maxlength="200"><button data-add="${c.id}">Añadir</button></div>`:''}
    </div>`;
  };
  $('#qList').innerHTML = (pend.map(card).join('')||'<small>Sin quejas pendientes. Todo en calma 🌊</small>')
    + (done.length?`<h2 style="margin-top:16px">Transformadas</h2>${done.map(card).join('')}`:'');
}

/* ---- eventos ---- */
$('#gAdd').onclick=async()=>{ if(await addGratitude($('#gIn').value,'diaria')) $('#gIn').value=''; $('#gIn').focus(); };
$('#gIn').onkeydown=e=>{ if(e.key==='Enter') $('#gAdd').click(); };
$('#qAdd').onclick=async()=>{ await addComplaint($('#qIn').value); $('#qIn').value=''; };
$('#qIn').onkeydown=e=>{ if(e.key==='Enter') $('#qAdd').click(); };
$('#qList').onclick=async e=>{
  const o=e.target.dataset.open, a=e.target.dataset.add;
  if(o){ S.open=S.open===o?null:o; render(); }
  if(a){ const inp=document.querySelector(`[data-in="${a}"]`); if(await addGratitude(inp.value,'queja',a)){ const n=document.querySelector(`[data-in="${a}"]`); if(n) n.focus(); } }
};
$('#qList').onkeydown=e=>{ if(e.key==='Enter'&&e.target.dataset.in) document.querySelector(`[data-add="${e.target.dataset.in}"]`).click(); };

$('#tLogin').onclick=()=>{S.mode='login';$('#tLogin').classList.add('act');$('#tSign').classList.remove('act');};
$('#tSign').onclick=()=>{S.mode='sign';$('#tSign').classList.add('act');$('#tLogin').classList.remove('act');};
$('#goAuth').onclick=async()=>{
  const email=$('#email').value.trim(), password=$('#pass').value;
  const r = S.mode==='login' ? await sb.auth.signInWithPassword({email,password}) : await sb.auth.signUp({email,password});
  if(r.error) return toast(r.error.message);
  if(S.mode==='sign' && !r.data.session) return toast('Revisa tu correo para confirmar la cuenta.');
};
$('#out').onclick=()=>sb.auth.signOut();

/* Recalcular el día si la app queda abierta pasada la medianoche */
setInterval(()=>{ if(S.user) render(); }, 60000);

sb.auth.onAuthStateChange((_ev,session)=>{
  S.user=session?.user||null;
  $('#auth').classList.toggle('hidden',!!S.user);
  $('#app').classList.toggle('hidden',!S.user);
  if(S.user) load();
});