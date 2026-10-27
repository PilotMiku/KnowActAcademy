export function welcomePage() {
  return `<div class="welcome-shell">
    <div class="welcome-orbit" aria-hidden="true"><span></span></div>
    <header class="welcome-header">
      <a class="welcome-brand" href="#/welcome" aria-label="知行学习起始页"><img src="./icon.svg" alt=""><span>知行学习</span></a>
      <span class="welcome-caption">学习，从这里开始</span>
    </header>
    <main id="main" class="welcome-main" tabindex="-1">
      <div class="welcome-rule" aria-hidden="true"></div>
      <blockquote class="welcome-quote">
        <h1><span>行是知之始，</span><span>知是行之成。</span></h1>
        <footer><span aria-hidden="true">——</span> <cite>陶行知</cite></footer>
      </blockquote>
      <a class="welcome-enter" href="#/">进入学习<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
    </main>
    <footer class="welcome-footer" aria-label="学习方式"><a href="#/practice">题库练习</a><span aria-hidden="true">·</span><a href="#/prepare">加权备考</a><span aria-hidden="true">·</span><a href="#/knowledge">知识复习</a></footer>
  </div>`;
}
