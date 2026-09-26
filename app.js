
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getDatabase(app);
let uid, room, isHost=false, me="", state=null;
const $=id=>document.getElementById(id);
const show=id=>{document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")};
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const diceChar=n=>"⚀⚁⚂⚃⚄⚅"[n-1];
let audioCtx=null;
function audio(){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended") audioCtx.resume();
    return audioCtx;
  }catch{return null}
}
function tone(freq=440,d=.08,type="square",gain=.035,delay=0){
  try{
    const a=audio(); if(!a)return;
    const o=a.createOscillator(),g=a.createGain();
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(gain,a.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+delay+d);
    o.connect(g);g.connect(a.destination);
    o.start(a.currentTime+delay);o.stop(a.currentTime+delay+d);
  }catch{}
}
function beep(freq=440,d=.08){tone(freq,d,"square",.035)}
function buttonSound(){tone(650,.055,"square",.022)}
function countdownSound(){[0,.18,.36].forEach((x,i)=>tone(380+i*90,.11,"square",.035,x));tone(820,.22,"sawtooth",.04,.55)}
function diceSound(){for(let i=0;i<14;i++)tone(120+Math.random()*240,.045,"square",.018,i*.045)}
function winSound(){[523,659,784,1047].forEach((f,i)=>tone(f,.22,"triangle",.04,i*.09))}
function loseSound(){[330,247,196].forEach((f,i)=>tone(f,.28,"sawtooth",.035,i*.12))}
document.addEventListener("pointerdown",e=>{audio();if(e.target.closest("button"))buttonSound()},{passive:true});

let lastPartyKey="";
function showPartyResult(){
  if(!state?.dice || !state?.players)return;
  const key=`${state.round}|${state.dice.join(",")}`;
  if(key===lastPartyKey)return;
  lastPartyKey=key;

  const total=state.dice.reduce((a,b)=>a+b,0);
  const winning=total<=10?"low":"high";
  const losers=Object.values(state.players).filter(p=>p.choice && p.choice!==winning).map(p=>p.name);
  const mine=state.players?.[uid];
  const overlay=$("resultOverlay");

  diceSound();
  setTimeout(()=>{
    if(mine?.choice===winning) winSound();
    else if(mine?.choice) loseSound();

    if(losers.length && overlay){
      $("overlayTitle").textContent="HALF GLASS!";
      $("overlayNames").textContent=`${losers.join(" • ")} — LOST`;
      overlay.classList.remove("hidden");
      document.body.classList.add("party-flash");
      setTimeout(()=>document.body.classList.remove("party-flash"),1200);
      setTimeout(()=>overlay.classList.add("hidden"),3400);
    }
  },500);
}

async function boot(){
  const cred=await signInAnonymously(auth); uid=cred.user.uid;
  $("status").textContent="● Online";
}
boot().catch(()=>{$("status").textContent="● Setup needed"});

$("create").onclick=async()=>{
 me=$("name").value.trim()||"Host"; room=code(); isHost=true;
 await set(ref(db,`rooms/${room}`),{host:uid,status:"lobby",round:0,dice:null,created:Date.now()});
 await joinPlayer(); watch(); show("lobby");
};
$("join").onclick=async()=>{
 me=$("name").value.trim()||"Player"; room=$("roomInput").value.trim().toUpperCase();
 if(!room)return alert("Enter a room code.");
 const s=await get(ref(db,`rooms/${room}`)); if(!s.exists())return alert("Room not found.");
 isHost=s.val().host===uid; await joinPlayer(); watch(); show("lobby");
};
async function joinPlayer(){
 await set(ref(db,`rooms/${room}/players/${uid}`),{name:me,score:0,choice:"",online:true});
 onDisconnect(ref(db,`rooms/${room}/players/${uid}/online`)).set(false);
 $("roomCode").textContent=room;
}
function watch(){
 onValue(ref(db,`rooms/${room}`),snap=>{
   state=snap.val(); if(!state)return;
   isHost=state.host===uid;
   document.querySelectorAll(".hostOnly").forEach(x=>x.style.display=isHost?"block":"none");
   renderPlayers(); renderGame();
   if(state.status==="lobby")show("lobby"); else show("game");
 });
}
function renderPlayers(){
 const ps=Object.entries(state.players||{});
 $("players").innerHTML=ps.map(([id,p])=>`<div class="player"><b>${esc(p.name)}</b><small>${p.online===false?"offline":id===state.host?"HOST":"ready"}</small></div>`).join("");
}
function renderGame(){
 $("round").textContent=state.round||1;
 const ps=Object.values(state.players||{}), picked=ps.filter(p=>p.choice).length;
 $("chosenCount").textContent=`${picked}/${ps.length} READY`;
 $("scores").innerHTML=ps.sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="scoreRow"><span>${esc(p.name)}</span><b>${p.score||0} pts</b></div>`).join("");
 const mine=state.players?.[uid]?.choice;
 ["low","high"].forEach(x=>$(x).classList.toggle("selected",mine===x));
 const rolled=Array.isArray(state.dice);
 if(rolled){
   $("diceBox").innerHTML=state.dice.map(n=>`<span>${diceChar(n)}</span>`).join("");
   const t=state.dice.reduce((a,b)=>a+b,0), result=t<=10?"LOW":"HIGH";
   $("total").textContent=`TOTAL ${t}`; $("result").textContent=`${result}!`;
   $("callout").textContent="ROUND RESULT";
   showPartyResult();
   $("roll").classList.add("hidden"); $("next").classList.remove("hidden");
 }else{
   $("diceBox").innerHTML="<span>⚀</span><span>⚀</span><span>⚀</span>";
   $("total").textContent="TOTAL —"; $("result").textContent="";
   $("callout").textContent=state.status==="choosing"?"MAKE YOUR CHOICE!":"GET READY!";
   $("roll").classList.toggle("hidden",state.status!=="choosing"); $("next").classList.add("hidden");
 }
}
$("start").onclick=()=>isHost&&update(ref(db,`rooms/${room}`),{status:"choosing",round:1,dice:null});
$("low").onclick=()=>choose("low"); $("high").onclick=()=>choose("high");
async function choose(c){if(state?.status!=="choosing"||state.dice)return;beep(c==="low"?330:550);await set(ref(db,`rooms/${room}/players/${uid}/choice`),c)}
$("roll").onclick=async()=>{
 if(!isHost||state.status!=="choosing")return;
 const ps=Object.values(state.players||{}); if(ps.some(p=>!p.choice))return alert("Wait until everyone has chosen.");
 $("diceBox").classList.add("rolling"); countdownSound(); setTimeout(diceSound,520);
 setTimeout(()=> $("diceBox").classList.remove("rolling"),800);
 const d=[1,2,3].map(()=>Math.floor(Math.random()*6)+1), total=d.reduce((a,b)=>a+b,0), result=total<=10?"low":"high";
 const updates={dice:d,status:"result"};
 Object.entries(state.players||{}).forEach(([id,p])=>{ if(p.choice===result)updates[`players/${id}/score`]=(p.score||0)+1; });
 await update(ref(db,`rooms/${room}`),updates); setTimeout(()=>beep(760,.16),350);
};
$("next").onclick=async()=>{
 if(!isHost)return; const u={dice:null,status:"choosing",round:(state.round||0)+1};
 Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");
 await update(ref(db,`rooms/${room}`),u);
};
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
