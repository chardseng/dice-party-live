import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const fb=initializeApp(firebaseConfig),auth=getAuth(fb),db=getDatabase(fb);
let uid="",room="",me="",state=null,isHost=false,audioCtx=null,soundOn=true,ambience=null;
let lastOverlayKey="",lastCountdownKey="",hostCountdownTimer=null;
const $=id=>document.getElementById(id);
const show=id=>{document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const diceChar=n=>"⚀⚁⚂⚃⚄⚅"[n-1];
const roomCode=()=>Math.random().toString(36).slice(2,8).toUpperCase();

function audio(){if(!soundOn)return null;try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx}catch{return null}}
function tone(f=440,d=.08,type="square",gain=.025,delay=0){const a=audio();if(!a)return;try{const o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(gain,a.currentTime+delay);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+delay+d);o.connect(g);g.connect(a.destination);o.start(a.currentTime+delay);o.stop(a.currentTime+delay+d)}catch{}}
function clickSound(){tone(620,.05,"square",.018)}
function readySound(){tone(392,.09,"triangle",.025);tone(523,.09,"triangle",.025,.09);tone(659,.12,"triangle",.025,.18)}
function tick(n){tone(n===1?880:560,.12,"square",.045)}
function lockSound(){tone(980,.18,"sawtooth",.04);tone(1240,.12,"square",.025,.1)}
function rollSound(){for(let i=0;i<20;i++)tone(100+Math.random()*340,.04,"square",.018,i*.045)}
function winSound(){[523,659,784,1047].forEach((f,i)=>tone(f,.24,"triangle",.04,i*.09))}
function loseSound(){[330,294,247].forEach((f,i)=>tone(f,.28,"sawtooth",.03,i*.12))}
function startAmbience(){if(ambience||!soundOn)return;ambience=setInterval(()=>{if(state?.status==="choosing"){tone(165,.12,"triangle",.006);tone(247,.08,"triangle",.005,.12)}},1500)}
function stopAmbience(){clearInterval(ambience);ambience=null}
document.addEventListener("pointerdown",e=>{audio();if(e.target.closest("button"))clickSound()},{passive:true});
$("soundToggle").onclick=()=>{soundOn=!soundOn;$("soundToggle").textContent=soundOn?"🔊 SOUND ON":"🔇 SOUND OFF";if(soundOn){audio();readySound();startAmbience()}else stopAmbience()};

async function boot(){const c=await signInAnonymously(auth);uid=c.user.uid;$("status").textContent="● Online"}
boot().catch(()=>{$("status").textContent="● Setup needed"});

$("create").onclick=async()=>{me=$("name").value.trim()||"Host";room=roomCode();audio();await set(ref(db,`rooms/${room}`),{host:uid,status:"lobby",round:0,dice:null,result:null,countdownEnd:null,created:Date.now()});await joinPlayer();watch();show("lobby")};
$("join").onclick=async()=>{me=$("name").value.trim()||"Player";room=$("roomInput").value.trim().toUpperCase();audio();if(!room)return alert("Enter a room code.");const s=await get(ref(db,`rooms/${room}`));if(!s.exists())return alert("Room not found.");await joinPlayer();watch();show("lobby")};
async function joinPlayer(){await set(ref(db,`rooms/${room}/players/${uid}`),{name:me,score:0,choice:"",online:true});onDisconnect(ref(db,`rooms/${room}/players/${uid}/online`)).set(false);$("roomCode").textContent=room}

function watch(){onValue(ref(db,`rooms/${room}`),snap=>{state=snap.val();if(!state)return;isHost=state.host===uid;document.querySelectorAll(".hostOnly").forEach(x=>x.style.display=isHost?"block":"none");renderPlayers();if(state.status==="lobby"){stopAmbience();show("lobby")}else{show("game");renderGame();syncPhase()}})}
function onlineEntries(){return Object.entries(state?.players||{}).filter(([,p])=>p.online!==false)}
function renderPlayers(){$("players").innerHTML=onlineEntries().map(([id,p])=>`<div class="player"><b>${esc(p.name)}</b><small>${id===state.host?"HOST":"READY"}</small></div>`).join("")}

function renderGame(){
  const entries=onlineEntries(),ps=entries.map(x=>x[1]),picked=ps.filter(p=>p.choice).length,mine=state.players?.[uid],rolled=Array.isArray(state.dice);
  $("round").textContent=state.round||1;$("chosenCount").textContent=`${picked}/${ps.length} READY`;
  $("scores").innerHTML=entries.map(([id,p])=>`<div class="scoreRow"><span>${esc(p.name)}${id===uid?" (YOU)":""}</span><span class="pick">${p.choice?String(p.choice).toUpperCase():"WAITING"}</span><b>${p.score||0} pts</b></div>`).join("");
  ["small","big"].forEach(c=>{$(c).classList.toggle("selected",mine?.choice===c);$(c).classList.toggle("locked",state.status!=="choosing")});
  $("next").classList.toggle("hidden",!(isHost&&state.status==="result"));
  $("personalResult").classList.toggle("hidden",state.status!=="result");

  if(rolled){
    const total=state.total ?? state.dice.reduce((a,b)=>a+b,0),result=(state.result|| (total<=10?"small":"big")).toUpperCase();
    $("diceBox").innerHTML=state.dice.map(n=>`<span>${diceChar(n)}</span>`).join("");
    $("total").textContent=`TOTAL ${total}`;$("result").textContent=`${result} WINS!`;$("phaseLabel").textContent="ROUND RESULT";$("waitMessage").textContent="Same result on every phone";
    const won=mine?.choice===result.toLowerCase();
    $("personalBadge").textContent=won?"✨ YOU WIN!":"❌ YOU LOSE";
    $("personalText").textContent=won?"Correct prediction!":"Your prediction did not match the result.";
    $("challenge").classList.toggle("hidden",won||!mine?.choice);
    $("challengeNote").classList.toggle("hidden",won||!mine?.choice);
  }else{
    $("diceBox").innerHTML="<span>⚀</span><span>⚀</span><span>⚀</span>";$("total").textContent="TOTAL —";$("result").textContent="";$("personalResult").classList.add("hidden");
    if(state.status==="choosing"){
      $("phaseLabel").textContent=mine?.choice?"CHOICE LOCKED ✓":"MAKE YOUR PREDICTION";
      const left=ps.length-picked;$("waitMessage").textContent=mine?.choice?(left?`Waiting for ${left} player${left===1?"":"s"}…`:"Everyone ready…"):"Choose SMALL or BIG";
    }else if(state.status==="countdown"){$("phaseLabel").textContent="CHOICES LOCKED";$("waitMessage").textContent="Rolling in a moment…"}
    else if(state.status==="rolling"){$("phaseLabel").textContent="ROLLING DICE";$("waitMessage").textContent="Good luck!"}
  }
}

function syncPhase(){
  if(state.status==="choosing"){startAmbience();if(isHost)maybeStartCountdown()}
  else stopAmbience();
  if(state.status==="countdown")runSharedCountdown();
  if(state.status==="rolling")animateRolling();
  if(state.status==="result")showResultOverlay();
}

async function maybeStartCountdown(){
  const ps=onlineEntries().map(x=>x[1]);if(!ps.length||ps.some(p=>!p.choice))return;
  // host alone advances the shared room to countdown
  if(state.status==="choosing")await update(ref(db,`rooms/${room}`),{status:"countdown",countdownEnd:Date.now()+3400});
}
function runSharedCountdown(){
  const key=`${state.round}|${state.countdownEnd}`;if(lastCountdownKey===key)return;lastCountdownKey=key;
  const overlay=$("countdownOverlay"),big=$("countdownBig");overlay.classList.remove("hidden");
  let last=null;
  const timer=setInterval(async()=>{
    if(!state||state.status!=="countdown"){clearInterval(timer);overlay.classList.add("hidden");return}
    const ms=(state.countdownEnd||Date.now())-Date.now(),n=Math.max(0,Math.ceil(ms/1000));
    const label=n>0?String(n):"LOCK!";
    if(label!==last){last=label;big.textContent=label;big.style.animation="none";void big.offsetWidth;big.style.animation="pop .55s ease";if(n>0)tick(n);else lockSound()}
    if(ms<=-350){clearInterval(timer);overlay.classList.add("hidden");if(isHost&&state.status==="countdown")await hostRoll()}
  },80);
}
async function hostRoll(){
  if(hostCountdownTimer)return;hostCountdownTimer=true;
  await update(ref(db,`rooms/${room}`),{status:"rolling"});
  rollSound();await new Promise(r=>setTimeout(r,1050));
  const a=new Uint32Array(3);crypto.getRandomValues(a);const d=[...a].map(x=>x%6+1),total=d.reduce((x,y)=>x+y,0),result=total<=10?"small":"big";
  const u={dice:d,total,result,status:"result",countdownEnd:null};
  Object.entries(state.players||{}).forEach(([id,p])=>{if(p.choice===result)u[`players/${id}/score`]=(p.score||0)+1});
  await update(ref(db,`rooms/${room}`),u);hostCountdownTimer=null;
}
function animateRolling(){
  $("diceBox").classList.add("rolling");let i=0;const t=setInterval(()=>{if(!state||state.status!=="rolling"){clearInterval(t);$("diceBox").classList.remove("rolling");return}$("diceBox").innerHTML=[0,1,2].map(()=>`<span>${diceChar(Math.floor(Math.random()*6)+1)}</span>`).join("");if(++i===1)rollSound()},90);
}

function showResultOverlay(){
  const key=`${state.round}|${(state.dice||[]).join("-")}|${state.result}`;if(lastOverlayKey===key)return;lastOverlayKey=key;
  const mine=state.players?.[uid],won=mine?.choice===state.result;
  const losers=Object.values(state.players||{}).filter(p=>p.online!==false&&p.choice&&p.choice!==state.result).map(p=>p.name);
  $("overlayResult").textContent=`${String(state.result||"").toUpperCase()} WINS • TOTAL ${state.total}`;
  $("overlayTitle").textContent=won?"WINNER!":"LOSER!";
  $("overlayIcon").textContent=won?"🎉":"🥤";
  $("overlayNames").textContent=won?"Correct prediction!":`${esc(mine?.name||"Player")} — your prediction lost`;
  $("overlayChallenge").classList.toggle("hidden",won||!mine?.choice);$("overlayNote").classList.toggle("hidden",won||!mine?.choice);
  $("overlayCard").classList.toggle("lose",!won&&!!mine?.choice);$("resultOverlay").classList.remove("hidden");
  document.body.classList.add("partyFlash");setTimeout(()=>document.body.classList.remove("partyFlash"),1100);
  won?winSound():loseSound();
}
$("closeOverlay").onclick=()=>$("resultOverlay").classList.add("hidden");

$("start").onclick=async()=>{if(!isHost)return;readySound();const u={status:"choosing",round:1,dice:null,total:null,result:null,countdownEnd:null};Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");await update(ref(db,`rooms/${room}`),u)};
$("small").onclick=()=>choose("small");$("big").onclick=()=>choose("big");
async function choose(c){if(state?.status!=="choosing")return;tone(c==="small"?370:560,.12,"triangle",.03);await set(ref(db,`rooms/${room}/players/${uid}/choice`),c)}
$("next").onclick=async()=>{if(!isHost)return;$("resultOverlay").classList.add("hidden");lastCountdownKey="";const u={status:"choosing",round:(state.round||0)+1,dice:null,total:null,result:null,countdownEnd:null};Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");await update(ref(db,`rooms/${room}`),u);readySound()};