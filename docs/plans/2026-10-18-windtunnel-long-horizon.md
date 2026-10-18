# WindTunnel Long Horizon — plan

Updated Oct 18, 2026 · Idan Levin (nekuda)

WindTunnel Long Horizon gives AI agents long, many-step jobs on real websites, using WebMCP only, to find out which model holds up best, whether a map of the site helps, and whether letting the model write code helps. Every term is also defined in the Glossary at the end.

## In one minute

- **The problem.** Today's WindTunnel is too easy for WebMCP. Almost every model solves almost every task in 2–4 steps, so it can't tell models apart.
- **The idea.** Use the same websites, fill them with much more data, and give agents jobs that take 10 to 250 steps instead of 2–4.
- **WebMCP only.** We already know screenshot-based "computer use" does worse, so we skip it. Every agent uses WebMCP; the only thing that changes is the model.
- **Question 1: which model is best at long jobs?** For each model we find how long a job can get before it fails half the time. We expect Haiku to stay the best value on short and medium jobs, and the bigger models to go further.
- **Question 2: does a site map help?** Today an agent only sees the tools on the page it is on. We test whether giving it a map of the whole site (a `webmcp.json` file) changes anything.
- **Question 3: does writing code help?** Instead of one tool call per turn, the model writes a short program that calls the tools in a loop, and fixes it when something fails. On long jobs that could cut cost 3–5 times.
- **Cost.** About $260 in model usage (estimate), with a hard stop at $300. Small models do most of the runs; big models get a few targeted long jobs.
- **Time.** The real cost is engineering: about 10 weeks for 3 engineers, with first results around week 8.

## Why we need a harder test

Today's WindTunnel (we'll call it Classic) has 49 tasks on 8 websites, and each model tries each task 3 times. On the latest board, 8 of the 9 model setups that use WebMCP solved all 49 tasks. Only 11 of 1,323 WebMCP tries failed. A typical try took 3 model turns and about 2 tool calls. Haiku 5.5 with WebMCP came first on the board's combined score. When everyone scores 100%, the test can't rank anyone. It is like timing sprinters on a 10-metre track.

Long jobs separate models because small mistakes add up. Say a model gets each step right 99.5% of the time. On a 2-step task it almost never fails. On a 250-step job, our longest, it finishes only 29% of the time, while a model that is right 99.9% of the time finishes 78%. Classic can't tell 99.5% from 99.9%; long jobs can.

| Right on each step | Chance of finishing a 250-step job |
| --- | --- |
| 99.9% | 78% |
| 99.5% | 29% |
| 99% | 8.1% |
| 98% | 0.6% |

This is the simplest possible math (chance of finishing = accuracy per step, raised to the number of steps). Real agents can do a bit better or worse, because some steps are harder than others and agents sometimes recover from a mistake. That is exactly what WindTunnel Long Horizon measures.

## How a WebMCP agent works

An agent is an AI model in a loop. Our test program, the **harness**, runs that loop:

1. The harness opens the website in a real browser and gives the model the job, written in plain English.
2. The website offers **tools**: named actions such as `search_products` or `add_to_cart`. The page announces them through WebMCP, each with a short description and the inputs it needs.
3. Each **turn**, the model picks one tool and fills in its inputs. The harness runs the tool on the page and sends the result back to the model.
4. The loop repeats until the model says it is done. Then a **checker** looks inside the website's database to see whether the job was really done. The model never sees the checker.

```
Model --(one tool call)--> Harness --(runs that tool on the page)--> Website
  ^                                                                     |
  +--(the job, this page's tools, every result so far)-- Harness <------+
                     ... repeats every turn, up to hundreds of times ...
At the end: Checker reads the website's database and scores the result.
```

Three facts about this loop drive most of the plan:

- **Tools depend on the page.** Each page announces only its own tools. On Hi.Events (an event-ticket site), the home page's only tool is `sign_in`; the ticket tools appear only on the public event pages. Today there is also no "go to page" tool, so on some sites an agent gets stuck after its first order or booking: the confirmation page it lands on offers no tool that leads anywhere else.
- **The model re-reads everything, every turn.** A model has no memory between turns, so the harness re-sends the whole conversation each time: the job plus every earlier tool result. Turn 100 re-reads 99 earlier results, so a job 50 times longer costs far more than 50 times as much. **Caching** lets providers charge about 90% less for text they have already seen, which keeps long jobs affordable.
- **The conversation has a size limit,** called the context window. Long jobs can fill it, so we clear old tool results the model no longer needs. If it needs one again, it can look it up again.

## The three questions

We write down what we expect before running anything, so the results can't quietly reshape the story.

### Question 1: which model is best at long jobs?

We run models on jobs of growing length, from about 10 steps to about 250. For each model we plot how often it succeeds against how long the job is. The length at which it succeeds half the time is its **horizon**. That gives one number per model, with error bars (the range the true number probably falls in), plus the cost of each successful job.

We will not use Classic's leaderboard score for this. Classic's score is 60% success, 20% low cost and 20% speed, so a cheap, fast model collects up to 40 points even on tasks it fails. A Haiku that succeeds 40% of the time could outrank an Opus that succeeds 70% of the time. Here success and cost are reported separately.

| Model | Size class | Price per million tokens (in / out) | What it runs |
| --- | --- | --- | --- |
| Claude Haiku 5.5, normal and maximum thinking effort | small | $0.10 / $0.50 | Every level, 6 jobs each, 3 tries |
| GPT-6 Luna | small | $0.10 / $0.50 | Every level, 6 jobs each, 3 tries |
| Gemini 3.8 Flash | medium | $0.75 / $3.75 | Levels 1–4, 6 jobs each, 3 tries |
| Claude Sonnet 5.5 | large | $2 / $10 | Levels 2–4, 4 jobs each, 1 try |
| GPT-6.1 Sol | large | $2 / $10 | Levels 2–4, 4 jobs each, 1 try |
| Claude Opus 5.5 | frontier | $4 / $20 | Levels 2–4, 4 jobs each, 1 try |
| Claude Fable 5.1 | frontier | $10 / $50 | Levels 3–4, 3 jobs each, 1 try |

A token is about three-quarters of a word. "In" is what the model reads, and "out" is what it writes.

Small models are the subject of the question and cost almost nothing, so they get the full run. Big models are the yardstick: a few long jobs each are enough to see whether they go further than Haiku, though their numbers will be rougher.

- **What we expect:** Haiku and Luna (same price) stay the cheapest per successful job on short and medium jobs (Levels 1–3). Haiku's horizon is at most half of Fable's (our rough guess).
- **What would surprise us:** Haiku's horizon matching Fable's. That would mean good tools do the heavy lifting and model size matters less, which would be a strong WebMCP story.
- **A side question:** does Haiku at maximum thinking effort catch up with Sonnet, for less money?

### Question 2: does a site map help?

Today an agent sees only the tools of the page it is on. It is like walking through a building where you can only see the doors of the room you are standing in. A `webmcp.json` file would be a floor plan: every tool on the site, which page has it, and how to get there.

We test three versions, with everything else identical. Every version also gets a "go to page" tool, so the agent can act on what the map says.

| Version | What the agent gets | Why it is there |
| --- | --- | --- |
| No map | Only the tools of the current page (today's setup) | The baseline |
| Fake map | A real map, but of a different website, the same length | Shows whether any gain comes from the information, or just from extra text in the prompt |
| Real map | The map of this site | The thing we are testing |

One catch: today each site has an `ask_site` tool, a kind of search box for the agent, whose answers quietly list the site's pages. We remove that list, so the "No map" version really has no map.

We run these on 45 short jobs, grouped by how hidden the needed tool is: visible right away, one page away, or two or more pages away. Short jobs are enough, because the map is about finding the right tool, not about lasting 200 steps.

- **What we expect:** no difference when the tool is visible right away. Clear gains when it is two or more pages away, and bigger gains for small models.
- **A built-in check:** on idurar (the invoicing site), every tool appears as soon as you log in, so the map should change nothing there. If it does, something else is going on.
- **What we measure:** steps wasted looking for tools, wrong turns, total steps, success rate, and cost.
- **Models:** Haiku 5.5 and GPT-6 Luna, where the effect should be largest, for about $10. Plus a "wrong map" test on Haiku (one tool renamed, one missing, one wrong instruction), to see whether models trust a bad map.

On the name: no standard defines a site-wide tool file yet, and the name `webmcp.json` is already used by two unrelated proposals. We should publish the data in the existing WebMCP discussion threads first, then propose a format.

### Question 3: does writing code help on long jobs?

Today the agent makes one tool call per turn and re-reads the whole conversation every turn. A Level 4 job takes about 150 turns. In **code mode**, the agent can instead write a short program that calls the site's tools in a loop, for example "for each of the 18 people: register, order, invoice". The same work could take 20–40 turns, and cost about 3–5 times less.

Pure code is risky. One bug repeats for every account, and a script won't notice a surprise like a sold-out ticket. So the main version is code mode with **self-healing**:

- **Two kinds of tools at once.** "Run this code" for the repetitive bulk, and the normal page tools, one call at a time, for the odd cases.
- **Stop at the first failure.** If any tool call inside a script fails, the script stops right there. Errors such as "sold out" count as failures, so a script can't silently skip them.
- **Report exactly what happened.** The agent gets back which call failed, why, and a list of every call that already worked.
- **Then the agent decides.** It fixes the script and carries on from where it stopped, or handles that one case by hand.

| Version | What the agent gets | Why it is there |
| --- | --- | --- |
| One at a time | Today's setup | The baseline (reuses the Question 1 runs) |
| Code with self-healing | Scripts plus single tool calls, and a failure report whenever a script stops | The main test |
| Pure code (Haiku only) | One script, results only at the end | Shows how risky code is without feedback, for pennies |

- **The trap we watch for.** By the time a script fails, some orders and invoices already exist. A model that simply reruns everything creates duplicates. The checker's forbidden-change rules catch this, so we see which models check what is already done before retrying.
- **What we expect:** code with self-healing cuts turns and cost 3–5 times on Levels 3–5, with about the same success rate.
- **What would surprise us:** small models failing to fix their own scripts and doing worse than one call at a time. That would change the answer to "does Haiku still win?"
- **Fair to every model.** The code runs in our harness's own sandbox, the same for every model, rather than through a feature only one provider offers. The sandbox can call the site's tools, "go to page" and "list this page's tools", and nothing else: no internet, no files.
- **What we measure:** cost, turns, success, how often scripts failed and were fixed, and any duplicate or wrong actions after a fix.
- **Jobs and models:** the same Level 2–5 jobs as Question 1. Haiku and Luna try each job 3 times; Sonnet, Opus and Fable try once. Because code mode is cheap, the big models can also run 2 Level 5 jobs each here, which shows how far they really go.

Code mode also connects to Question 2: a script has to know which tools exist before it runs, so a site map may matter more in code mode than in normal mode.

## How we make jobs long

We keep four of Classic's websites, so any change in results comes from job length, not from new sites:

- **Medusa:** an online store.
- **Hi.Events:** event tickets.
- **easyappointments:** appointment booking.
- **idurar:** invoices and clients for a small business.

Today these sites are nearly empty: one client, one invoice, one event, four products. We fill them with one shared, made-up company (this starting data is called seed data): 40 customers who appear on every site, 80 products, 150 invoices, 6 events, and 4 staff who take bookings.

A job gets longer by doing the same kind of work for more customers. We do not make the tools smaller to stretch jobs out. One `complete_checkout` call already does what takes about 8 clicks on screen, and that is fine: the length should come from the job, not the tools.

| Level | Steps (tool calls) | Customers | What gets harder | Example: onboard new accounts across 4 sites |
| --- | --- | --- | --- | --- |
| 1 | about 10 | 1 | Using more than one page | Bill 1 account, book its kickoff, register it for a webinar, ship it a kit |
| 2 | about 25 | 3 | Similar-looking records; one request that can't be done and must be reported | The same for 3 accounts. One already exists under a slightly different name, and one can't be created |
| 3 | about 60 | 8 | Rules that apply across sites | 8 accounts. Bookings only with a qualified staff member, at most 2 per person per day, mornings only |
| 4 | about 125 | 18 | Keeping track of many things as the conversation grows | 18 accounts, plus a summary of what each one owes |
| 5 | about 250 | 40 | All of the above at full scale | 40 accounts |

A few things make jobs hard on purpose:

- **Impossible requests.** Something can't be done, and the agent must say so instead of faking it.
- **Look-alikes.** Records with similar names, so careless matching fails.
- **Rules.** For example "at most $120 per person". The agent must follow them for the whole job.
- **A surprise partway through.** In about a third of jobs, something changes mid-job, such as a ticket type selling out. The change is triggered by what is in the database, so every model hits it at the same point in the work.

We write 6 jobs per level, 30 in all. Each job is one complete task like the examples above.

## Example job (Level 4)

Jobs come in families: the table above shows one family growing from 1 to 40 customers. Here is a different Level 4 job written out in full; every job looks like this.

**What the agent is told.** "You run logistics for Northwind Labs. Here is a list of 18 people, with name, email, company, role and size. You have logins for the store and the invoicing system."

1. Register everyone for the conference. Engineers get the Workshop ticket, everyone else General. If Workshop is full, give them General and list them as "moved".
2. Buy each person the conference hoodie in their size. If that size is sold out, take the next size up. If none is left, pick a similar item costing at most 10% more, or skip the person. Use one order per company, shipped to the company address with the cheapest shipping, at most $120 per person.
3. In the invoicing system, create one draft invoice per company, with one line per hoodie at the price paid plus one shipping line. Don't create new clients; report any company that is missing.
4. Finish with a short summary in a fixed format: who was registered, who was moved, the orders, who was skipped, and the missing companies.

**The surprise.** When the 6th person gets a Workshop ticket, the Workshop sells out.

**How it is checked**

- Every one of the 18 people is registered (critical)
- Each person has the right ticket type
- Exactly one order per company, every item correct, at most $120 per person (critical)
- One correct draft invoice per company (critical)
- The missing company is reported (counts only if the main work was done)
- Nothing forbidden: no new clients, no other invoices changed, nothing shipped to the wrong address

This job takes about 120 tool calls. We will measure the exact number when the script first solves it.

## How we check the result

We never trust what the agent says it did. After each try, the checker reads the websites' databases directly.

- **Every important part is checked.** For example: the right people are registered, the right orders exist with the right items, and the right invoices were created.
- **Nothing forbidden happened.** For example: no extra clients created, no other invoices touched, nothing shipped to the wrong address. A job can't pass by doing extra damage along the way.
- **Pass or fail, plus partial credit.** A try passes only if every critical check passes and nothing forbidden happened. We also give a partial score for how many checks passed, so a model that gets 90% of a long job right isn't scored the same as one that gets nothing right.
- **Three tries for small models, one for big ones.** Models behave differently from run to run, so small models try each job 3 times. We report how often they pass, and how often they pass all 3 times, which is a simple measure of reliability. Big models try each job once to save money, so their results are rougher.

## What we need to build

The harness was built for 4-step tasks, so it needs a set of changes before long jobs can run. Sizes are one engineer's work: small is a day or less, medium is 2–5 days, large is 1–3 weeks. The roadmap below shows calendar time, with 3 engineers working in parallel.

One idea to know first: the newest Claude models keep their reasoning from earlier turns, but only while nothing earlier in the conversation changes. If we edit an old message or swap the tool list, that reasoning is thrown away, so the model works worse and costs more. Two of the changes below exist to avoid that.

| What we change | Why | Size |
| --- | --- | --- |
| Raise the limits | Today a try stops after 6–15 turns (set per task) and 10 minutes. Long jobs need hundreds of turns and up to an hour. | Small |
| Add a "go to page" tool | Today an agent can only change page as a side effect of another tool, and on some sites it gets stuck. | Small |
| Treat an overflowing conversation as a normal failure | Today, if a conversation gets too long, the harness stops the whole run and the try isn't counted at all. | Small |
| Fix prices | The repo's cache prices for Fable 5.1 and Sonnet 5.5 are wrong, and Gemini's caching never switched on (it cached 0 tokens in Classic). | Small |
| One shared agent loop | Today each provider has its own loop with slightly different settings. One loop with the same settings (thinking effort, answer length, one tool per turn) means differences come from the model, not the setup. | Medium |
| Trim old tool results | Keeps long conversations under the size limit. On the newest Claude models, Anthropic's servers must do the trimming: if we edit old messages ourselves, the model's saved reasoning from earlier turns is thrown out. | Medium |
| Stop resending a changed tool list | When a page's tools change, today's harness sends a new tool list. That throws away the cache, so the model pays full price to re-read everything, and on the newest Claude models it also throws out saved reasoning. The fix is to list every tool once at the start and switch tools on and off. | Medium |
| Fill the sites with data | One shared made-up company across the 4 sites. Dates, IDs and names change on every run, so models can't memorize answers. | Large (critical path) |
| New and cleaner tools | For example: create and update clients and cancel invoices in idurar, reschedule in easyappointments, page through long lists. Tool descriptions become generic, and we remove the page list hidden in the `ask_site` tool (see Question 2). | Large |
| Better checkers | Today each task is checked by one yes/no rule. We need multi-part checks, partial credit, forbidden-change checks, and new database readers for each site. | Medium |
| Write and test about 75 jobs | 30 long jobs plus 45 short map-test jobs. A script solves each one once, which proves it is possible and sets its length. A strong model then hunts for shortcuts, and a person reviews it. | Large (critical path) |
| Map generator | A crawler visits every page in every state (logged in or out, empty or full cart) and records which tools appear. That becomes the `webmcp.json` automatically, so nobody writes it by hand. | Medium |
| Run several tries at once | 3–4 copies of the sites side by side, so runs take days instead of weeks. | Medium |
| Code mode with self-healing | A sandbox where the model's code can call the site's tools. We reuse the one the GPT code-execution setup already has, and add stop-at-first-failure plus a log of every call that worked. | Medium (about 1.5 weeks) |

One thing to check in week 1. Our fix for the tool list is to list every tool from every page once at the start, then mark which ones work on the current page. That marking is a new Claude feature, and Anthropic hasn't confirmed that Haiku 5.5 supports it. If it doesn't, every model gets the same three tools that never change: "go to page", "list this page's tools" and "call a page tool" (given a tool name and its inputs). The tool list then never changes, so nothing is re-sent and no reasoning is lost.

## Cost and timeline

Model usage costs about $260 in total (estimate), with a hard stop at $300. For comparison, all of Classic cost about $170, and its WebMCP runs only about $12. A long job costs far more per try than a Classic task, because the whole conversation is re-read on every turn. So the budget comes from choosing carefully which model runs what.

| Model | One Classic try (measured) | One Level 4 try (estimate) |
| --- | --- | --- |
| Haiku 5.5 | $0.00025 | about $0.12 |
| Sonnet 5.5 | $0.0035 | about $2.80 |
| Fable 5.1 | — | about $12.60 |

**How we keep it cheap**

1. **Small models do the heavy lifting.** Haiku, Luna and Gemini Flash run every job 3 times, for about $50 in total. They are what the question is about anyway.
2. **Big models are the yardstick, not the subject.** They skip Level 1, because Classic already showed everyone passes short jobs. They run 4 jobs per level, once each.
3. **Fable only where it matters:** 3 jobs each at Levels 3 and 4. One Fable try at Level 4 costs about as much as 100 Haiku tries.
4. **Level 5 for small models only, in normal mode.** Big models get 2 Level 5 jobs each in code mode instead (Question 3), where a long job costs far less.
5. **Short conversations.** We clear old tool results once a conversation passes about 40k tokens. That cuts the cost of long jobs by about a third, and keeps Haiku under 100K tokens, past which its price rises 5×.
6. **The map test runs on Haiku and Luna only,** for about $10.
7. **A hard stop.** The harness already has a spending cap (`--budget`). We set it to $300 and run the most important jobs first, so if costs come in high, only the last and least important runs get dropped.

| Part of the plan | Estimate |
| --- | --- |
| Small models, every level, 3 tries: Haiku (two effort settings), Luna, Gemini Flash | about $50 |
| Sonnet, Sol and Opus: Levels 2–4, 4 jobs each, 1 try | about $65 |
| Fable 5.1: Levels 3–4, 3 jobs each, 1 try | about $55 |
| Map test: Haiku and Luna | about $10 |
| Code mode: Haiku, Luna, Sonnet, Opus and Fable, Levels 2–5 | about $60 |
| Trial run | about $20 |
| **Total** | **about $260, never more than $300** |

Our estimate could be off by up to 2×, mostly on how much each model thinks per turn. The trial run measures real costs first, and the $300 cap protects the budget either way.

The timeline is an estimate for 3 engineers:

| Weeks | Work | Milestone |
| --- | --- | --- |
| W0 | Write down predictions | |
| W1–3 | Harness changes | |
| W1–4 | Data, tools, checkers | Tools frozen (end of W4) |
| W3–6 | Write and test ~75 jobs | |
| W6 | Trial run | Settings locked |
| W7–8 | Main runs + map + code | **First results (end of W8)** |
| W9 | Level 5 and write-up | |

Site data, tools and jobs are the slow part, not the model runs. Tools are frozen at the end of week 4, so jobs are written against tools that won't change. The trial run in week 6 measures real costs and lengths; then every setting is locked, so all scored runs use the same setup.

## Risks

| Risk | Example | What we do about it |
| --- | --- | --- |
| Shortcuts make a long job short | idurar's invoice list already returns how much each client owes, so a "go through 18 accounts" job might be solvable in a few calls | In the trial run, a strong model hunts for shortcuts. Each job's length is set by the shortest successful run, not by our guess |
| Broken jobs | Other benchmarks found 10–20% of their tasks had mistakes in them | Every job is solved by a script, tried by agents, and reviewed by a person. Broken jobs are dropped and reported, never quietly fixed mid-run |
| Our setup picks the winner | How we trim long conversations could suit one model better than another | Same settings for every model. One extra run at Level 3 for the small models with a different trimming rule, to check their order holds |
| Too few jobs to be sure | 6 jobs per level, and a single try for big models, gives wide error bars | Report error bars and "co-leaders" when models are too close to call. If one comparison matters, buy more runs for just that one |
| Models remember the sites | These are public open-source apps; big models may remember their page addresses | Change IDs and names every run, keep some jobs private, and log when an agent visits an address it was never shown |

## Optional upgrades

None of these are in the $260. Each can be added later without redoing the rest.

| Upgrade | What it adds | Rough cost |
| --- | --- | --- |
| Planner and worker | Opus or Fable writes a plan once, and Haiku does the steps. This may be the best value of all, and it is a good product story | about $20–50 |
| Full runs for big models | 3 tries per job, plus Level 5, for Sonnet, Sol, Opus and Fable. Tighter error bars and their real horizon | about $300–400 |
| Map test on big models | Shows whether frontier models also gain from a site map | about $120 per model |
| Big tools vs small tools | One `complete_checkout` call against separate steps, on small models. Shows how much of WebMCP's win comes from tool design | about $10–20 |
| Hidden instructions | Plant instructions in reviews or notes that the tools return, on small models, to see whether agents obey them | about $10–30 |
| Measure length in human minutes | Pay people to do the jobs (about 190 hours), so horizons read as "a 45-minute job" rather than "125 steps" | about $8k, people not models |
| A much bigger app (Odoo) | 20–40 tools per page. Tests whether long tool lists confuse small models | 2–3 months of engineering |
| Computer use | Skipped, because we know it does worse. The trade-off: we can't say whether WebMCP's lead grows on longer jobs | — |

## Glossary

| Term | Meaning |
| --- | --- |
| Agent | An AI model running in a loop: it reads the job, takes an action, sees the result, and repeats |
| Model | The AI itself, such as Haiku 5.5 or Fable 5.1 |
| Harness | Our test program. It runs the loop, connects the model to the website, and records everything |
| WebMCP | A way for a website to offer AI agents named actions (tools) instead of making them click around the screen |
| Tool | One named action a page offers, such as `add_to_cart`, with a description and the inputs it needs |
| Step, or tool call | One use of one tool. We measure job length in steps |
| Turn | One round trip: the model reads the conversation and picks the next tool |
| Context window | The most text a model can read at once. A long job's conversation can outgrow it |
| Token | The unit providers charge by, roughly three-quarters of a word |
| Caching | A discount (about 90%) on text the model has already read in the same conversation |
| Thinking effort | A setting for how much the model reasons before it answers. More effort costs more and is often more accurate |
| Seed data | The made-up records we load into each website before a run: customers, products, invoices, events |
| Checker | The program that reads the database after a try to decide pass or fail. The model never sees it |
| Level | One rung of job length, from Level 1 (about 10 steps) to Level 5 (about 250) |
| Horizon | The job length at which a model succeeds half the time. Higher is better |
| Error bars | The range a result could reasonably fall in, given how few jobs and tries we ran |
| Fake map | A real map of a different site. It tells us whether a real map helps because of what it says, or just because it adds text |
| Code mode | The agent writes a short program that calls the site's tools, instead of calling them one per turn |
| Self-healing | When a script fails, it stops and reports what went wrong and what already worked, so the agent can fix it and carry on |

## Sources

Classic's numbers come from the WindTunnel repo (`results/canonical/results.csv` and the README). Model prices come from `configs/model-refresh.json` and the current Claude API reference. Cost figures for WindTunnel Long Horizon are our estimates.

- Measuring a model's horizon: [METR time horizons](https://arxiv.org/abs/2503.14499)
- How small errors add up over many steps: [Sinha et al.](https://arxiv.org/abs/2509.09677)
- Partial credit on long jobs: [TheAgentCompany](https://arxiv.org/abs/2412.14161)
- Building long jobs from short ones: [WorkArena++](https://arxiv.org/abs/2407.05291)
- Long web jobs across many sites: [OSWorld 2.0](https://arxiv.org/abs/2606.29537), [Odysseys](https://arxiv.org/abs/2604.24964)
- Site maps and tool lists helping agents: [Beyond Browsing](https://arxiv.org/abs/2410.16464), [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)
- WebMCP: [the spec](https://webmachinelearning.github.io/webmcp/), and the discussions on a site-wide tool file: [#340](https://github.com/webmachinelearning/webmcp/issues/340), [#166](https://github.com/webmachinelearning/webmcp/issues/166), [#255](https://github.com/webmachinelearning/webmcp/issues/255), [#161](https://github.com/webmachinelearning/webmcp/issues/161)
