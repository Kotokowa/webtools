'use strict';
const toc=document.getElementById('toc'),toggle=document.querySelector('.toc-toggle');
toggle.addEventListener('click',()=>{const open=toc.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));});
const links=[...toc.querySelectorAll('a')];
for(const link of links)link.addEventListener('click',()=>{if(innerWidth<=750){toc.classList.remove('open');toggle.setAttribute('aria-expanded','false');}});
const sections=[...document.querySelectorAll('main section[id]')];
let pending=false;
function updateCurrent(){
 pending=false;
 const offset=innerWidth<=750?110:60;
 let current=sections[0];
 for(const section of sections){if(section.getBoundingClientRect().top<=offset)current=section;else break;}
 for(const link of links){if(link.hash==='#'+current.id)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');}
}
function schedule(){if(!pending){pending=true;requestAnimationFrame(updateCurrent);}}
addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);updateCurrent();
