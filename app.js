import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const fb=initializeApp(firebaseConfig), auth=getAuth(fb), db=getDatabase(fb);
let uid, room, isHost=false, me="", state=null;
let audioCtx=null, soundOn=true, ambienceTimer=null, lastResultKey="", rollingNow=false;

const $=id=>document.getElementById(id);
const show=id=>{document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")};
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const diceChar=n=>"⚀⚁⚂⚃⚄⚅"[n-1];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function audio(){
  if(!soundOn)return null;
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended") audioCtx.resume();
    return audioCtx;
  }catch{return null}
}
function tone(freq=440,d=.08,type="square",gain=.03,delay=0){
  const a=audio(); if(!a)return;
  try{
    const o=a.createOscillator(),g=a.createGain();
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(gain,a.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+delay+d);
    o.connect(g);g.connect(a.destination);
    o.start(a.currentTime+delay);o.stop(a.currentTime+delay+d);
  }catch{}
}
function clickSound(){tone(620,.05,"square",.02)}
function readySound(){tone(420,.07,"triangle",.018);tone(620,.08,"triangle",.018,.08)}
function tickSound(n){tone(n===1?880:520,.12,"square",.05)}
function lockSound(){tone(980,.22,"sawtooth",.05)}
function diceSound(){for(let i=0;i<18;i++)tone(110+Math.random()*300,.045,"square",.025,i*.04)}
function winSound(){[523,659,784,1047].forEach((f,i)=>tone(f,.25,"triangle",.045,i*.10))}
function loseSound(){[330,277,220].forEach((f,i)=>tone(f,.30,"sawtooth",.035,i*.12))}
function startAmbience(){
  if(ambienceTimer||!soundOn)return;
  ambienceTimer=setInterval(()=>{
    if(state?.status==="choosing"&&!state?.dice){
      tone(150,.12,"triangle",.008);
      tone(225,.08,"triangle",.006,.10);
    }
  },1600);
}
function stopAmbience(){clearInterval(ambienceTimer);ambienceTimer=null}

document.addEventListener("pointerdown",e=>{
  audio();
  if(e.target.closest("button"))clickSound();
},{passive:true});

$("soundToggle").onclick=()=>{
  soundOn=!soundOn;
  $("soundToggle").textContent=soundOn?"🔊 SOUND ON":"🔇 SOUND OFF";
  if(soundOn){audio();readySound();startAmbience()}else stopAmbience();
};

async function boot(){
  const cred=await signInAnonymously(auth);uid=cred.user.uid;
  $("status").textContent="● Online";
}
boot().catch(()=>{$("status").textContent="● Setup needed"});

$("create").onclick=async()=>{
  me=$("name").value.trim()||"Host";room=code();isHost=true;audio();
  await set(ref(db,`rooms/${room}`),{host:uid,status:"lobby",round:0,dice:null,created:Date.now()});
  await joinPlayer();watch();show("lobby");
};
$("join").onclick=async()=>{
  me=$("name").value.trim()||"Player";room=$("roomInput").value.trim().toUpperCase();audio();
  if(!room)return alert("Enter a room code.");
  const s=await get(ref(db,`rooms/${room}`));if(!s.exists())return alert("Room not found.");
  isHost=s.val().host===uid;await joinPlayer();watch();show("lobby");
};
async function joinPlayer(){
  await set(ref(db,`rooms/${room}/players/${uid}`),{name:me,score:0,choice:"",online:true});
  onDisconnect(ref(db,`rooms/${room}/players/${uid}/online`)).set(false);
  $("roomCode").textContent=room;
}
function watch(){
  onValue(ref(db,`rooms/${room}`),snap=>{
    state=snap.val();if(!state)return;
    isHost=state.host===uid;
    document.querySelectorAll(".hostOnly").forEach(x=>x.style.display=isHost?"block":"none");
    renderPlayers();renderGame();
    if(state.status==="lobby"){stopAmbience();show("lobby")}else{show("game");startAmbience()}
  });
}
function renderPlayers(){
  const ps=Object.entries(state.players||{});
  $("players").innerHTML=ps.map(([id,p])=>`<div class="player"><b>${esc(p.name)}</b><small>${p.online===false?"offline":id===state.host?"HOST":"ready"}</small></div>`).join("");
}
function renderGame(){
  $("round").textContent=state.round||1;
  const entries=Object.entries(state.players||{}), ps=entries.map(x=>x[1]), picked=ps.filter(p=>p.choice).length;
  $("chosenCount").textContent=`${picked}/${ps.length} READY`;
  $("scores").innerHTML=[...ps].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="scoreRow"><span>${esc(p.name)}</span><b>${p.score||0} pts</b></div>`).join("");

  const mine=state.players?.[uid]?.choice;
  ["low","high"].forEach(x=>{
    $(x).classList.toggle("selected",mine===x);
    $(x).classList.toggle("locked",state.status!=="choosing"||!!state.dice);
  });

  const rolled=Array.isArray(state.dice);
  if(rolled){
    stopAmbience();
    $("waitMessage").textContent="Round complete";
    $("diceBox").innerHTML=state.dice.map(n=>`<span>${diceChar(n)}</span>`).join("");
    const t=state.dice.reduce((a,b)=>a+b,0), result=t<=10?"LOW":"HIGH";
    $("total").textContent=`TOTAL ${t}`;$("result").textContent=`${result}!`;
    $("callout").textContent="ROUND RESULT";
    $("roll").classList.add("hidden");$("next").classList.remove("hidden");
    showResultOverlay(t,result);
  }else{
    $("diceBox").innerHTML="<span>⚀</span><span>⚀</span><span>⚀</span>";
    $("total").textContent="TOTAL —";$("result").textContent="";
    $("callout").textContent=state.status==="choosing"?"MAKE YOUR PREDICTION!":"GET READY!";
    if(state.status==="choosing"){
      const left=ps.length-picked;
      $("waitMessage").textContent=left>0?`Waiting for ${left} player${left===1?"":"s"}…`:"Everyone ready — host can roll!";
    }
    $("roll").classList.toggle("hidden",state.status!=="choosing");$("next").classList.add("hidden");
  }
}
function showResultOverlay(total,result){
  const key=`${state.round}|${(state.dice||[]).join(",")}`;
  if(key===lastResultKey)return;
  lastResultKey=key;
  const winning=result.toLowerCase();
  const losers=Object.values(state.players||{}).filter(p=>p.choice&&p.choice!==winning).map(p=>p.name);
  const mine=state.players?.[uid];
  const overlay=$("resultOverlay");
  $("overlayResult").textContent=`${result} WINS • TOTAL ${total}`;
  $("overlayTitle").textContent=losers.length?"HALF GLASS!":"EVERYONE SAFE!";
  $("overlayNames").textContent=losers.length?`${losers.join(" • ")} — PARTY CHALLENGE`:"No losing prediction this round";
  overlay.classList.remove("hidden");
  document.body.classList.add("party-flash");
  if(mine?.choice===winning)winSound();else if(mine?.choice)loseSound();
  setTimeout(()=>document.body.classList.remove("party-flash"),1300);
  setTimeout(()=>overlay.classList.add("hidden"),5000);
}

$("start").onclick=async()=>{
  if(!isHost)return;audio();readySound();
  await update(ref(db,`rooms/${room}`),{status:"choosing",round:1,dice:null});
};
$("low").onclick=()=>choose("low");
$("high").onclick=()=>choose("high");
async function choose(c){
  if(state?.status!=="choosing"||state.dice||rollingNow)return;
  tone(c==="low"?330:550,.12,"triangle",.035);
  await set(ref(db,`rooms/${room}/players/${uid}/choice`),c);
}
function countdown(){
  return new Promise(resolve=>{
    stopAmbience();
    const el=$("countdown");
    let n=3;
    const showN=()=>{
      el.textContent=n>0?String(n):"LOCK!";
      el.classList.remove("hidden");
      el.style.animation="none";void el.offsetWidth;el.style.animation="";
      if(n>0)tickSound(n);else lockSound();
      if(n<0){el.classList.add("hidden");resolve();return}
      n--;setTimeout(showN,n<0?550:850);
    };
    showN();
  });
}
$("roll").onclick=async()=>{
  if(!isHost||state.status!=="choosing"||rollingNow)return;
  const ps=Object.values(state.players||{});
  if(ps.some(p=>!p.choice))return alert("Wait until everyone has made a prediction.");
  rollingNow=true;
  await update(ref(db,`rooms/${room}`),{status:"locked"});
  await countdown();
  $("diceBox").classList.add("rolling");diceSound();
  await new Promise(r=>setTimeout(r,950));
  $("diceBox").classList.remove("rolling");
  const d=[1,2,3].map(()=>Math.floor(Math.random()*6)+1);
  const total=d.reduce((a,b)=>a+b,0),result=total<=10?"low":"high";
  const updates={dice:d,status:"result"};
  Object.entries(state.players||{}).forEach(([id,p])=>{
    if(p.choice===result)updates[`players/${id}/score`]=(p.score||0)+1;
  });
  await update(ref(db,`rooms/${room}`),updates);
  rollingNow=false;
};
$("next").onclick=async()=>{
  if(!isHost)return;
  const u={dice:null,status:"choosing",round:(state.round||0)+1};
  Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");
  await update(ref(db,`rooms/${room}`),u);
  readySound();startAmbience();
};