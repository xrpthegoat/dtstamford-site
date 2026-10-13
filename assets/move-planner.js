/* In-memory planning only. No storage, network requests, or automatic messages. */
(() => {
  const steps = [
    { key: 'kind', title: 'What does your next chapter look like?', hint: 'Choose the starting point that feels right.', options: ['Buying', 'Selling', 'Renting', 'Relocating', 'Exploring options'] },
    { key: 'area', title: 'Where are you thinking about?', hint: 'A town or neighborhood is enough. Still deciding? Leave this blank.' },
    { key: 'timing', title: 'When would you like to make a move?', hint: 'A rough idea is all you need.', options: ['As soon as practical', 'In the next few months', 'Later on', 'Still figuring it out'] },
    { key: 'priorities', title: 'What would make the biggest difference?', hint: 'Choose any that apply, or continue without selecting.', multiple: true, options: ['Understanding my budget', 'Finding the right location', 'Planning a sale', 'Coordinating timing', 'Learning the next steps'] }
  ];
  let answers = { kind: '', area: '', timing: '', priorities: [] };
  let step = 0;
  const $ = id => document.getElementById(id);
  const panel = $('planner-panel'), result = $('plan-result'), content = $('planner-step');
  const back = $('plan-back'), next = $('plan-next'), error = $('planner-error');
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function focus(el) {
    el.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function saveArea() { if (step === 1) answers.area = $('plan-area').value.trim(); }
  function draw(moveFocus = true) {
    const current = steps[step];
    panel.hidden = false; result.hidden = true; error.hidden = true;
    $('step-label').textContent = `Step ${step + 1} of ${steps.length}`;
    $('plan-progress').value = step + 1;
    $('plan-progress').textContent = `${step + 1} of ${steps.length}`;
    document.querySelectorAll('.planner-sidebar li').forEach((el, i) => {
      if (i === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    back.disabled = step === 0;
    next.textContent = step === 3 ? 'Build my checklist →' : 'Continue →';
    const heading = node('h2', current.title); heading.id = 'plan-question'; heading.tabIndex = -1;
    content.replaceChildren(heading, node('p', current.hint, 'planner-hint'));
    if (current.options) {
      const group = node('div', undefined, 'plan-options'); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', 'plan-question');
      current.options.forEach(value => {
        const button = node('button', value, 'plan-option'); button.type = 'button';
        const selected = () => current.multiple ? answers.priorities.includes(value) : answers[current.key] === value;
        button.setAttribute('aria-pressed', String(selected()));
        button.addEventListener('click', () => {
          if (current.multiple) answers.priorities = selected() ? answers.priorities.filter(x => x !== value) : [...answers.priorities, value];
          else { answers[current.key] = value; group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false')); }
          button.setAttribute('aria-pressed', String(selected())); error.hidden = true;
        });
        group.append(button);
      });
      content.append(group);
    } else {
      const label = node('label', 'Town or neighborhood (optional)', 'plan-field'); label.htmlFor = 'plan-area';
      const input = node('input'); input.id = 'plan-area'; input.type = 'text'; input.maxLength = 80; input.value = answers.area; input.placeholder = 'For example, Stamford or nearby';
      label.append(input); content.append(label);
    }
    if (moveFocus) focus(heading);
  }
  function tasks() {
    const place = answers.area || 'the area you choose';
    const byKind = {
      Buying: [`List your must-haves and flexible preferences for a home in ${place}.`, 'Gather questions for a mortgage professional about financing and next steps.', 'Compare the homes you visit using the same notes: fit, questions and follow-up.'],
      Selling: ['Gather available home records and questions about your property’s history.', 'Walk through your home and note preparation or maintenance topics to discuss with John.', 'Review the seller disclosure questionnaire and answer from your own knowledge.'],
      Renting: [`List your rental must-haves and preferences for ${place}.`, 'Confirm availability, property-specific application requirements and any fees with John before applying.', 'Keep the documents requested by your application provider nearby; enter them only in the provider’s application.'],
      Relocating: ['Write down what your new location needs to support in your regular routine.', `Compare areas around ${place} against your priorities; verify commute and service details directly.`, 'List moving logistics, including belongings, dates and any temporary arrangements.'],
      'Exploring options': ['Write down what is prompting a possible move and what you hope could change.', 'Separate questions you can research from questions that need a conversation.', 'Choose one low-pressure action that helps you learn more.']
    };
    const extra = {
      'Understanding my budget': 'Write down your budget questions to discuss with a qualified financial or lending professional.',
      'Finding the right location': `Compare locations against your own priorities for ${place}.`,
      'Planning a sale': 'Make a short list of home records, preparation questions and sale timing topics.',
      'Coordinating timing': 'Sketch the dates and decisions that may depend on each other.',
      'Learning the next steps': 'List your open questions and who can help answer each one.'
    };
    return [...byKind[answers.kind], ...answers.priorities.map(x => extra[x]), `Use your preferred timing — ${answers.timing.toLowerCase()} — to choose when to revisit this plan.`];
  }
  function showResult() {
    panel.hidden = true; result.hidden = false;
    const title = node('h2', 'Your next move, mapped out.'); title.id = 'result-title'; title.tabIndex = -1;
    const summary = node('p', `${answers.kind} · ${answers.area || 'Location to be decided'} · ${answers.timing}`, 'plan-result-summary');
    const list = node('ol', undefined, 'plan-checklist'); const items = tasks();
    items.forEach(text => list.append(node('li', text)));
    const actions = node('div', undefined, 'plan-result-actions');
    const download = node('button', 'Download my checklist ↓', 'plan-primary'); download.type = 'button';
    const status = node('p', 'Nothing has been sent. Email opens a draft for you to review.', 'plan-status'); status.setAttribute('role', 'status');
    const planText = `John Restrepo — My move plan\n${summary.textContent}\n\n${items.map((t,i) => `${i+1}. ${t}`).join('\n')}\n\nContact John: john@stamford-homes.com · 203-883-3399\nhttps://dtstamford.com/move-planner.html\n`;
    download.onclick = () => {
      const url = URL.createObjectURL(new Blob([planText], { type: 'text/plain;charset=utf-8' }));
      const link = node('a'); link.href = url; link.download = 'my-move-plan.txt'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000); status.textContent = 'Checklist download requested. Your answers remain here while this page is open.';
    };
    const email = node('a', 'Email John · open a draft ↗', 'plan-secondary');
    const body = `Hi John,\n\nI used your move planner and would like to discuss my next step.\n\n${summary.textContent}\nPriorities: ${answers.priorities.join(', ') || 'Still deciding'}\n\nCould we talk through a plan?`;
    email.href = `mailto:john@stamford-homes.com?subject=${encodeURIComponent('My move plan')}&body=${encodeURIComponent(body)}`;
    const edit = node('button', 'Edit answers', 'plan-secondary'); edit.type = 'button'; edit.onclick = () => { step = 0; draw(); };
    actions.append(download, email, edit);
    const links = node('div', undefined, 'plan-result-links');
    const link = node('a', answers.kind === 'Selling' ? 'Open property disclosure wizard ↗' : answers.kind === 'Renting' ? 'Open application center ↗' : 'Explore homes ↗');
    link.href = answers.kind === 'Selling' ? 'disclosure/' : answers.kind === 'Renting' ? 'applications.html' : 'search.html'; links.append(link);
    const reset = node('button', 'Clear answers and start again', 'plan-reset'); reset.type = 'button'; reset.onclick = () => { answers = { kind: '', area: '', timing: '', priorities: [] }; step = 0; result.replaceChildren(); draw(); };
    result.replaceChildren(node('p', 'Your personal starting checklist', 'planner-kicker'), title, summary, list, actions, status, links, reset);
    document.querySelectorAll('.planner-sidebar li').forEach(el => el.removeAttribute('aria-current'));
    title.focus({ preventScroll: true }); result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  $('planner-form').addEventListener('submit', event => {
    event.preventDefault(); saveArea();
    const current = steps[step];
    if ((step === 0 || step === 2) && !answers[current.key]) {
      error.textContent = 'Choose an option to continue.'; error.hidden = false;
      content.querySelector('button').focus(); return;
    }
    if (step < 3) { step++; draw(); } else showResult();
  });
  back.onclick = () => { saveArea(); if (step > 0) { step--; draw(); } };
  draw(false);
})();
