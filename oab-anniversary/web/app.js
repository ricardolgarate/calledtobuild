const $=selector=>document.querySelector(selector);
function smsUrl(phone,message){return `sms:${phone}${/iPad|iPhone|iPod/.test(navigator.userAgent)?'&':'?'}body=${encodeURIComponent(message)}`;}
const dialog=$('#share-dialog');
const nameInput=$('#share-name');
const codeInput=$('#share-code');
const picker=$('#name-picker');
const results=$('#client-matches');
const lookupStatus=$('#name-lookup-status');
const shareError=$('#share-error');
const createButton=$('#create-link');
const supportLink=$('#share-support');
const retryButton=$('#retry-name-lookup');
let matches=[];
let activeIndex=-1;
let selectedClient=null;
let lastSelectedMatch=null;
let searchTimer=null;
let searchController=null;
let selectionController=null;
let lookupVersion=0;
let composing=false;
let sharing=false;
function nameLetterCount(value){return (value.normalize('NFKD').replace(/\p{M}/gu,'').match(/\p{L}/gu)||[]).length;}
function closeResults(){
  results.hidden=true;nameInput.setAttribute('aria-expanded','false');nameInput.removeAttribute('aria-activedescendant');
  activeIndex=-1;
  for(const option of results.children)option.setAttribute('aria-selected','false');
}
function clearResults(){closeResults();matches=[];results.replaceChildren();}
function cancelLookups(){
  lookupVersion++;clearTimeout(searchTimer);searchTimer=null;
  searchController?.abort();selectionController?.abort();searchController=null;selectionController=null;
  nameInput.removeAttribute('aria-busy');codeInput.removeAttribute('aria-busy');
}
function clearIssue(){shareError.hidden=true;shareError.textContent='';supportLink.hidden=true;retryButton.hidden=true;}
function statusLinks(){
  const name=nameInput.value.trim(),code=codeInput.value.trim();
  const message=`Hi Janae and Shawntay! Please check my OAB birthday referral status in the lead tracker and let me know how many completed free visits I still need.\n${name?'Name: '+name+'\n':''}${code?'Referral code: '+code:'I’ll send my name and referral code.'}`;
  document.querySelectorAll('[data-status-link]').forEach(link=>link.href=smsUrl('+14694765735',message));
}
function supportForName(name){
  supportLink.href=smsUrl('+14694765735',`Hi Janae and Shawntay! Please help me find my OAB birthday referral code. My name is ${name||'[your name]'}.`);
  supportLink.hidden=false;
}
function showIssue(message,{support=false,retry=false}={}){
  shareError.textContent=message;shareError.hidden=false;retryButton.hidden=!retry;
  if(support)supportForName(nameInput.value.trim());
}
function clearSelection(){
  selectedClient=null;lastSelectedMatch=null;codeInput.value='';codeInput.placeholder='Filled in when you choose your name';
  createButton.disabled=true;statusLinks();
}
function setActive(index){
  if(!matches.length)return;
  activeIndex=(index+matches.length)%matches.length;
  results.hidden=false;nameInput.setAttribute('aria-expanded','true');
  [...results.children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===activeIndex)));
  const active=results.children[activeIndex];nameInput.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});
}
async function selectClient(match){
  cancelLookups();clearResults();clearIssue();
  const version=lookupVersion;
  nameInput.value=match.name;codeInput.value='';createButton.disabled=true;
  selectedClient={id:match.id,name:match.name,code:''};lastSelectedMatch=match;statusLinks();
  if(!match.canShare){
    codeInput.placeholder='OAB will help with your code';lookupStatus.textContent='Your name is selected. Your code is not ready yet.';
    showIssue('OAB has not added your code yet. Text us and we’ll help.',{support:true});return;
  }
  lookupStatus.textContent='Adding your code…';codeInput.placeholder='Adding your code…';codeInput.setAttribute('aria-busy','true');
  const controller=new AbortController();selectionController=controller;
  try{
    const response=await fetch('/api/referral-code',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({clientId:match.id}),signal:controller.signal});
    const result=await response.json();
    if(version!==lookupVersion||selectedClient?.id!==match.id)return;
    if(!response.ok||result.ok!==true){
      if(result.error==='code_not_ready'){
        codeInput.placeholder='OAB will help with your code';lookupStatus.textContent='Your name is selected. Your code is not ready yet.';
        showIssue(result.message||'OAB has not added your code yet. Text us and we’ll help.',{support:true});return;
      }
      throw new Error(result.message||'We could not add your code. Please choose your name again.');
    }
    if(typeof result.referralCode!=='string'||!result.referralCode.trim()||result.referralCode.length>80)throw new Error('We could not add your code. Please try again.');
    const canonicalName=typeof result.clientName==='string'&&result.clientName.trim()?result.clientName.trim().slice(0,100):match.name;
    selectedClient={id:match.id,name:canonicalName,code:result.referralCode.trim()};
    nameInput.value=canonicalName;codeInput.value=selectedClient.code;codeInput.placeholder='Your code';
    createButton.disabled=false;lookupStatus.textContent='Your code is ready. You can make your text below.';statusLinks();
  }catch(failure){
    if(controller.signal.aborted||version!==lookupVersion)return;
    codeInput.placeholder='Choose your name to add your code';lookupStatus.textContent='We could not add your code.';
    showIssue(failure.message==='Failed to fetch'?'We could not reach OAB. Please try again.':failure.message,{support:true,retry:true});
  }finally{
    if(version===lookupVersion){codeInput.removeAttribute('aria-busy');selectionController=null;}
  }
}
function renderMatches(nextMatches,version){
  clearResults();matches=nextMatches;
  if(!matches.length){
    lookupStatus.textContent='No matching name found. Try more of your first or last name.';
    supportForName(nameInput.value.trim());return;
  }
  matches.forEach((match,index)=>{
    const option=document.createElement('button');option.type='button';option.className='client-match';option.id=`client-match-${version}-${index}`;
    option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.tabIndex=-1;
    const name=document.createElement('span');name.textContent=match.name;option.append(name);
    if(!match.canShare){const note=document.createElement('small');note.textContent='OAB can help with your code';option.append(note);}
    option.addEventListener('mousedown',event=>event.preventDefault());
    option.addEventListener('click',()=>selectClient(match));results.append(option);
  });
  const isFocused=document.activeElement===nameInput;
  results.hidden=!isFocused;nameInput.setAttribute('aria-expanded',String(isFocused));
  lookupStatus.textContent=matches.length===1?'1 name found. Choose your name below.':`${matches.length} names found. Choose your name below.`;
}
async function searchNames(query,version){
  const controller=new AbortController();searchController=controller;nameInput.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/referral-clients',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({query}),signal:controller.signal});
    const result=await response.json();
    if(version!==lookupVersion||nameInput.value.trim()!==query)return;
    if(!response.ok||result.ok!==true)throw new Error(result.message||'We could not look up your name. Please try again.');
    if(!Array.isArray(result.matches))throw new Error('We could not look up your name. Please try again.');
    const safeMatches=result.matches.filter(match=>typeof match.id==='string'&&match.id.length<=160&&typeof match.name==='string'&&match.name.trim()&&match.name.length<=100).slice(0,5).map(match=>({id:match.id,name:match.name,canShare:match.canShare===true}));
    renderMatches(safeMatches,version);
  }catch(failure){
    if(controller.signal.aborted||version!==lookupVersion)return;
    clearResults();lookupStatus.textContent='We could not look up your name.';
    showIssue(failure.message==='Failed to fetch'?'We could not reach OAB. Please try again.':failure.message,{support:true,retry:true});
  }finally{
    if(version===lookupVersion){nameInput.removeAttribute('aria-busy');searchController=null;}
  }
}
function scheduleSearch(){
  cancelLookups();clearResults();clearIssue();clearSelection();
  const query=nameInput.value.trim();
  if(nameLetterCount(query)<3){lookupStatus.textContent=query?'Type at least 3 letters to find your name.':'';return;}
  lookupStatus.textContent='Looking for your name…';const version=lookupVersion;
  searchTimer=setTimeout(()=>{searchTimer=null;searchNames(query,version);},300);
}
nameInput.addEventListener('focus',()=>{
  if(matches.length&&!selectedClient){results.hidden=false;nameInput.setAttribute('aria-expanded','true');}
});
nameInput.addEventListener('compositionstart',()=>{composing=true;});
nameInput.addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
nameInput.addEventListener('input',event=>{if(!event.isComposing&&!composing)scheduleSearch();});
nameInput.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'&&matches.length){event.preventDefault();setActive(activeIndex+1);}
  else if(event.key==='ArrowUp'&&matches.length){event.preventDefault();setActive(activeIndex<0?matches.length-1:activeIndex-1);}
  else if(event.key==='Enter'&&!results.hidden&&matches.length){
    event.preventDefault();if(activeIndex>=0)selectClient(matches[activeIndex]);else if(matches.length===1)selectClient(matches[0]);
    else lookupStatus.textContent='Use the arrow keys or tap your name to choose it.';
  }else if(event.key==='Escape'&&!results.hidden){event.preventDefault();event.stopPropagation();closeResults();}
});
nameInput.addEventListener('blur',()=>queueMicrotask(()=>{if(!picker.contains(document.activeElement))closeResults();}));
document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))closeResults();});
retryButton.addEventListener('click',()=>{if(lastSelectedMatch&&nameInput.value===lastSelectedMatch.name)selectClient(lastSelectedMatch);else scheduleSearch();});
function openShare(){
  dialog.showModal();document.body.classList.add('modal-open');
  if(!$('#share-setup').hidden){nameInput.focus();if(!selectedClient?.code&&nameLetterCount(nameInput.value)>=3)scheduleSearch();}
  else $('#share-sms').focus();
}
document.querySelectorAll('[data-share]').forEach(button=>button.addEventListener('click',openShare));
dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');cancelLookups();clearResults();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
statusLinks();
createButton.addEventListener('click',()=>{
  if(sharing)return;
  clearIssue();
  if(!selectedClient?.id||!selectedClient.code||nameInput.value.trim()!==selectedClient.name){
    createButton.disabled=true;showIssue('Choose your name from the list so we can add your code.');nameInput.focus();return;
  }
  sharing=true;createButton.disabled=true;
  try{
    const {name,code}=selectedClient;
    const url = new URL('https://anniversary.organizedandbeautiful.com/');
    url.searchParams.set('code', code);
    const message=`Hi! Organized & Beautiful helped with my home, and I thought of you. For their 3rd birthday, you can get a FREE in-person visit and $150 off home organizing if you book. Donation drop-off and product ordering are included with the job; you pay for the products you choose.\n\nUse my referral code: ${code}\nFrom: ${name}\nClaim your offer here: ${url.href}\n\nI earn a $150 Amazon gift card or $150 off my next service after 3 people I send each complete a free visit. The visits must be scheduled by December 31, 2026. No paid job is needed for the visit to count.`;
    $('#gift-url').value=url.href;$('#gift-message').value=message;$('#share-sms').href=smsUrl('',message);
    $('#share-result').hidden=false;$('#share-setup').hidden=true;statusLinks();$('#share-sms').focus();
  }finally{sharing=false;createButton.disabled=!selectedClient?.code;}
});
$('#edit-share').addEventListener('click',()=>{$('#share-setup').hidden=false;$('#share-result').hidden=true;nameInput.focus();nameInput.select();});
for(const [button,field,success] of [['#copy-link','#gift-url','Link copied. Send it to your friends.'],['#copy-message','#gift-message','Text and referral link copied. Send it to 3 friends or family members.']])$(button).addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($(field).value);$('#copy-status').textContent=success;}
  catch{$('.message-details').open=true;$(field).select();$('#copy-status').textContent='Select and copy the text above to share it.';}
});
const stickyObserver=new IntersectionObserver(([entry])=>$('.mobile-cta').classList.toggle('is-visible',!entry.isIntersecting&&entry.boundingClientRect.bottom<0),{threshold:0});
stickyObserver.observe($('#hero-primary'));
