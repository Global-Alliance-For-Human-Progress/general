let running = true;

async function sleep(ms){
  return new Promise(r => setTimeout(r, ms));
}

async function unfollowAll(){

  while(running){

    // find "Following" buttons
    const followBtns = [...document.querySelectorAll("span.artdeco-button__text")]
      .filter(el => el.innerText.trim() === "Following");

    if(followBtns.length === 0){
      // scroll to load more people
      window.scrollBy(0, 800);
      await sleep(1000);
      continue;
    }

    for(const span of followBtns){
      if(!running) return;

      const btn = span.closest("button");
      if(btn){
        btn.click(); // open unfollow dialog
        await sleep(500);

        // confirm unfollow
        const confirm = [...document.querySelectorAll("span.artdeco-button__text")]
          .find(el => el.innerText.trim() === "Unfollow");

        if(confirm){
          confirm.closest("button").click();
        }

        await sleep(500);
      }
    }

    await sleep(1000);
  }
}

unfollowAll();