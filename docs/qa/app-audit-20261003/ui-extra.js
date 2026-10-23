(async()=>{
  const {useSettingsStore}=await import('/src/stores/settings.js'),s=useSettingsStore()
  s.switchView('home');await new Promise(r=>setTimeout(r,500));s.isDrawerOpen=false
  const drawer=document.querySelector('.drawer'),link=drawer.querySelector('[tabindex="0"]');link.focus()
  const rect=link.getBoundingClientRect(),result=[{test:'closed-drawer-focusable',isOpen:s.isDrawerOpen,focusEnteredClosedDrawer:document.activeElement===link,offscreen:rect.right<0,ariaHidden:drawer.getAttribute('aria-hidden'),inert:drawer.inert}]
  result.push({test:'pwa',lang:document.documentElement.lang,manifest:!!document.querySelector('link[rel=manifest]'),controlledByServiceWorker:!!navigator.serviceWorker?.controller,registeredServiceWorkers:(await navigator.serviceWorker?.getRegistrations())?.length||0})
  s.switchView('settings');s.openGeneralSettingsSection('ai');await new Promise(r=>setTimeout(r,350))
  result.push({test:'ai-input-labels',inputs:[...document.querySelectorAll('.setting-section input')].map(e=>({placeholder:e.placeholder,associatedLabel:!!e.labels?.length,ariaLabel:!!e.getAttribute('aria-label')}))})
  return result
})()
