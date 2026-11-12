# Savings and savings goals in commercial budgeting apps and banks (excluding YNAB / Actual internals)

State as of 2026-11-12. Method notes that affect how much weight to give each finding:

- **Verified directly (full text read):** Monarch help centre (via its public Zendesk JSON API; the HTML pages return 403 to fetchers), EveryDollar help centre (same route), two Simplifi ideas-forum threads (raw HTML parsed, vote counts read from page data). Quotes from these are verbatim.
- **Read through a fetch summarizer:** Copilot help centre, Simplifi support article, Lunch Money blog and feedback board, Monzo community threads, MoneySavingExpert thread, World Bank blog, Rob Berger. Quotes from these were extracted by an automated summarizer and should be spot-checked before being published as verbatim.
- **Search-snippet only (weakest):** all Reddit material (reddit.com, old.reddit.com, the JSON API and redlib mirrors were all blocked or bot-walled), Copilot roadmap vote counts, most bank feature facts, Mint, Goodbudget, Qube, Tiller, PocketSmith, Rocket Money. Marked "(snippet)" below.
- **Not researched at all:** Empower/Personal Capital, Origin, Fina, Toshl, Wallet by BudgetBakers, Spendee, South-Asian "Money Manager" apps, Capital One multiple accounts, app-store reviews. See Gaps.

## Monarch Money: old goals, Goals 3.0 "save up goals", and how they meet the budget and cash flow

### Takeaway
Monarch's Goals 3.0 (introduced Dec 2025, migration now complete and irreversible) makes a goal a virtual claim on the balances of real accounts, with four separate ways to move money in or out and an explicit "spend from a goal" path that keeps the purchase out of the monthly budget. It is the most complete account-bound design found, and also the most intricate: it needs adjustment events, over-allocation alerts and a credit-card reconciliation step to keep goal balances and account balances agreeing. I could not retrieve r/MonarchMoney sentiment, so whether ex-YNAB users find it clearer is unanswered.

### Cited Findings

**Timeline**
- The help article introducing Goals 3.0 was created 2025-12-15 and last edited 2026-10-20; it now states "If you previously used the older Goals experience, your goals have been moved into the new system" and "Once your goals have been migrated, your data lives in the new system, so reverting isn't possible." — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch)
- A March 2026 review described Goals 3.0 as "still technically in public beta" (as rendered by summarizer; the page says it was written with AI assistance, so treat as low-reliability). — [personal-finance-tools review](https://personal-finance-tools.pages.dev/blog/monarch-money-winter-2026-review)
- "Moving Funds In and Out of Goals" was created 2026-02-18 and the growth-rates article 2026-04-01, so transaction linking detail and growth rates were documented after the initial launch. — [Moving Funds In and Out of Goals](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals); [Growth Rates in Save Up Goals](https://help.monarch.com/hc/en-us/articles/47822256713236-Growth-Rates-in-Save-Up-Goals)
- Monarch's stated reason for the redesign: "Goals 3.0 was built from the feedback of thousands of members who wanted clearer tracking, better budget integration, and support for spending from credit cards and more account types. The new system focuses on your real account balances and progress rather than individual transactions". — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch)

**What a goal is attached to**
- Goals are split into Save up goals and Pay down goals; pay-down goals are generated from liability accounts rather than created by hand. — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch)
- Goal-eligible accounts are chosen globally ("Manage all your contributing accounts globally, rather than per goal"): cash, investment and asset accounts (including real estate, vehicles, crypto). — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- Many goals per account and many accounts per goal are both supported: "A single account can contribute to multiple goals", or an account can be fully dedicated ("The account's entire balance is used for a single goal… That account cannot be used in any other goal. The goal itself can still include other accounts."). — [Moving Funds In and Out of Goals](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- Account money is shown as Available (not assigned to a goal), Allocated, or Over-allocated ("When your goal contributions exceed your real account balance"); Monarch alerts on over-allocation. — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)

**Four ways money moves (they can be mixed)**
- 1. Fully allocate an account: the goal tracks the account balance; each balance change creates at most one daily Adjustment event per account, and "Adjustments do not affect your budget." — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- 2. Manual fund allocation: creates Contribution/Withdrawal events with no transaction needed; "You can choose whether a manual allocation counts toward your budget actuals and whether it uses today's date or a past date". Allocations can also move money goal-to-goal and can be deleted. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals); [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- 3. Link income and transfer transactions (manually, in bulk, or by rule): linked transactions "automatically count toward your goal actuals in the budget. Positive-amount income or transfer transactions count as contributions, and negative-amount… count as withdrawals." — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- Documented pitfall of method 3: for a transfer you must link the positive receiving-side transaction; "Do not link the negative transaction from the sending account, because Monarch will treat that transaction as a withdrawal from the goal." If the receiving account isn't connected, a manual allocation is required instead. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- 4. Spend from a goal: link an expense transaction; it appears in goal activity, counts toward "Total spent", and "budget actuals are not affected… because you're spending money you've already saved." Rules cannot yet link expense transactions; that is manual only. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- Per-goal toggle "Spending reduces goal progress": on for refillable goals such as an emergency fund, off for one-time goals such as a vacation. — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- Spending on a credit card from a goal needs a reconciliation: link the expense, choose which contributing account will cover it, later match a real transfer or card payment whose amount is at least the selected spending; the stated purpose is to stop "Available for goals" looking higher than it is while the card payment is outstanding. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals); [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- Refunds on goal-funded purchases cannot be linked ("positive expense transactions are not yet supported"); the workaround is to split the original expense and leave the refunded part unlinked. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)

**Budget, cash flow, reports**
- Monarch's budget is cash-flow based, not balance based: "You can still follow an envelope or zero-based budgeting style in Monarch, as long as it's based on cash flow, where income = expenses + savings." "Account balances are used mainly for long-term goals, not day-to-day spending." — [Creating Your Budget in Monarch](https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch)
- A goal with a planned monthly contribution "automatically appears in the Contributions section of your Budget as a line item under Save Up Goals"; it can be edited for one month or all future months. — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- "The Transfer and Credit Card Payment categories are excluded from budgets and cash flow". — [Creating Your Budget in Monarch](https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch)
- Cash Flow and Reports show total income, total spending, net cash flow and a savings rate; Reports can be filtered by goal. — [Cash Flow](https://help.monarch.com/hc/en-us/articles/20504904768020-Cash-Flow); [Using Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports)
- Payroll-deducted saving breaks the budget arithmetic: because income is usually net pay, a goal contribution that includes 401(k)/HSA deductions makes the budget "look over-allocated"; the documented workaround is adding manual income transactions to represent gross pay. — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)

**Growth, completion, repurposing**
- Market movement and interest are kept out of the budget by the Adjustment mechanism; worked example: a $1,000 transfer plus $150 market gain shows as a $1,150 Adjustment and $0 budget actuals unless the transfer is linked, after which it shows $1,000 contribution and a $150 Adjustment. — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals)
- Projections use per-account growth rates (defaults 0% checking, 3% savings, 7% investment, -15% vehicles), only for fully allocated accounts; "Partial contributions don't factor in growth rates." — [Growth Rates](https://help.monarch.com/hc/en-us/articles/47822256713236-Growth-Rates-in-Save-Up-Goals); [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- Statuses On track / Ahead / At risk / Complete appear only when target amount, target date and planned contribution are all set. Archiving a goal withdraws its funds, keeps history, removes it from future budgets and can be undone. — [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals)
- Migration cost: the new timeline chart shows nothing before the migration date, old goal-linking rules did not carry over, and one-time migration events can make contribution totals exceed the visible activity list. — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch)

**Sentiment**
- A reviewer who says they used it since launch liked the save-up / pay-down split and the status indicator, and criticised that it is balance-based ("If you want to see exactly which transfers funded a specific goal, the detail isn't there yet"), that contribution assumptions "break down" for irregular income, and concluded "If you want granular envelope-style control, YNAB still wins" (as rendered by summarizer; March 2026, AI-assisted page). — [personal-finance-tools review](https://personal-finance-tools.pages.dev/blog/monarch-money-winter-2026-review)
- An aggregator analysing 14 Reddit posts flagged "Goals 3.0 is confusing/buggy" and named lack of true zero-based budgeting as the top reason users return to YNAB (snippet only; the page returned 404 when fetched; tiny sample). — [Discury YNAB vs Monarch](https://discury.io/vs/ynab-vs-monarch-money)
- Rob Berger (updated 2026-11-02) frames the choice as philosophy, not goals: YNAB "won't let you budget future income until it arrives" while Monarch uses "cash flow-based budgeting that allows you to plan with expected future income"; he does not review goal mechanics. — [Rob Berger](https://robberger.com/ynab-vs-monarch-money/)

### Inferences
- Goals 3.0 appears to have launched balance-only and re-added transaction linking and rules afterwards: the FAQ headings "Can I still link income or transfer transactions to goals?" and "Rules now support transaction linking for Goals!", plus the March 2026 review's complaint about missing transfer detail, point that way. This suggests users pushed back on losing the audit trail.
- The Monarch model needs two user-facing toggles ("count toward budget actuals" on allocations, "spending reduces goal progress" on goals) and three kinds of synthetic event (adjustment, migration, reconciliation). Each exists to reconcile a goal ledger with account balances. An envelope budget where category balances already are the claim on money would not need most of this.
- Because Monarch's budget is flow-based ("income = expenses + savings"), a goal contribution is a third budget section beside income and expenses, and goal-funded spending has to be explicitly excluded from the month. In a zero-based app the same purchase is simply spending from an envelope funded in earlier months.

### Gaps
- No direct r/MonarchMoney threads could be read; I cannot say whether ex-YNAB users find Goals 3.0 clearer or more confusing. This is the largest hole in these notes.
- Monarch has no public vote-count board that I found; no vote data.
- Exact formula of Monarch's savings rate and whether goal contributions alter "Left to budget" were not confirmed beyond the quoted sentences.
- Mechanics of the old (2.0) goals were not retrieved beyond Monarch's own description that they were transaction-based with limited activity tracking.

## Copilot Money: savings goals

### Takeaway
Copilot (goals launched 2025-05-28) uses the same family of design as Monarch: goals are pools fed by allocating account balances or linking transactions, kept out of categories and the spending total, and spent "through your categories" with a setting that decides whether goal-funded purchases count as monthly spend.

### Cited Findings
- Savings Goals shipped on 2025-05-28 as a Goals tab, with Copilot Intelligence suggesting goals from cash flow, categories and yearly recurring payments. — [Copilot dispatch](https://www.copilot.money/dispatch/savings-goals)
- "Goals are pools of money that you contribute to at any point and later spend through your categories." — [Goals FAQ](https://help.copilot.money/en/articles/11139571-goals-faq)
- Money set aside for goals in a month does not appear in the Categories tab or count toward the monthly Spending Total; the recommended plan is that the margin between average income and total budget should equal the monthly savings goal total. — [Savings with Copilot](https://help.copilot.money/en/articles/11471870-savings-with-copilot)
- Progress is updated two ways: edit the amount of each depository account's balance allocated to the goal (with an "Always use the entire balance" option), or link transactions; for transfers the user picks the side ("outgoing" decreases, "incoming" increases). — [Updating goal progress](https://help.copilot.money/en/articles/11100474-updating-goal-progress)
- The allocated part of an account balance is shown greyed out with the goal beside it; a balance allocation cannot be set to $0 while incoming transactions remain linked. — [Goals FAQ](https://help.copilot.money/en/articles/11139571-goals-faq)
- Spending: link any spending transaction to a goal, which lowers the saved amount (example: $4,000 saved, $500 car expense linked, $3,500 left). — [Spending from Savings Goals](https://help.copilot.money/en/articles/11100511-spending-from-savings-goals)
- "Update Budgets on Spend" setting: when on, linked transactions are removed from category spend and shown as a separate blue "Savings Goal spend" bar, effectively raising that category's budget by the amount; when off they count as normal monthly spend. — [Spending from Savings Goals](https://help.copilot.money/en/articles/11100511-spending-from-savings-goals)
- States are Active, Ready to Spend, Archived; reaching the target moves a goal to Ready to Spend; "Reactivate when funds dip" returns it to Active when spending takes it below target (recommended for sinking funds). Archived goals cannot be un-archived; deleting releases allocations. Goals cannot start in a future month. — [Goals FAQ](https://help.copilot.money/en/articles/11139571-goals-faq); [Updating goal progress](https://help.copilot.money/en/articles/11100474-updating-goal-progress)
- Open requests on Copilot's board include showing investment-account contributions (401k, 529, IRA) in the savings view and goal timelines that account for compound interest; the original "Savings goal feature" request showed about 162 upvotes (snippet; count may be imprecise). — [Copilot roadmap: investment contributions](https://roadmap.copilot.money/feature-requests/p/investment-account-contributions-included-in-savings-view); [Copilot roadmap: savings goals](https://roadmap.copilot.money/feature-requests/p/savings-goals)

### Inferences
- Copilot and Monarch converged independently on the same three pieces: balance allocation, transaction linking, and a per-goal switch for "does goal-funded spending hit this month". That convergence is evidence that flow-based budgets cannot avoid the "I saved for this, don't punish me this month" problem.
- Copilot's "Ready to Spend" state and "reactivate when funds dip" give a clean vocabulary for one-off goals versus refillable sinking funds.

### Gaps
- No r/copilotmoney sentiment retrieved. No confirmation whether goals support investment accounts as funding sources beyond a note about manual/investment accounts in transfer linking. Interest handling is undocumented.

## Quicken Simplifi: Savings Goals

### Takeaway
Simplifi goals are purely virtual earmarks on account balances that reduce an "Available balance" and feed the Spending Plan, with no transaction link and no history. The absence of "spend this transaction from the goal" has been its top goals complaint since early 2021 and is still unimplemented.

### Cited Findings
- "Simplifi does not move money in or out of your financial accounts." Contributions name a "take from" account and are supported for checking, savings and investment accounts; a goal can hold money from several accounts. — [Using Quicken Simplifi's Savings Goals](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals)
- Earmarked money is hidden from the spendable figure: example $5,410.00 balance less a $500.00 contribution gives $4,910.00 Available. — [Using Quicken Simplifi's Savings Goals](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals)
- Goals included in the Spending Plan count their monthly contribution plus extra contributions as planned outflow; excluded goals are greyed out. — [Using Quicken Simplifi's Savings Goals](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals)
- Two withdrawal types: "Spend a custom amount" (records spending against the goal without changing Saved So Far or the Spending Plan) and "Use for something else" (returns money to spendable and reduces the month's contribution). — [Using Quicken Simplifi's Savings Goals](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals)
- Stated limitations: contributions and withdrawals cannot be linked to transactions; goals keep no detailed history; corrections are possible only for the current month; deleting a goal removes past contributions and may change the Spending Plan. — [Using Quicken Simplifi's Savings Goals](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals)
- The idea "Link from Transaction to 'take from' or 'add to' Savings Goal" was posted 2021-02-01, has 274 votes and 72 comments, and its status is still "In Review" (read from page data on 2026-11-12). Original request: "I'd like to see an easy way to assign a specific transaction to be 'taken from' a savings goal… It saves step of having to manually go and 'take from' the savings goal." — [Simplifi ideas thread](https://community.simplifimoney.com/discussion/1357/link-from-transaction-to-take-from-savings-goal-1-merged-vote)
- Commenters in that thread want linked transactions "excluded from your spending plan by default" and describe using goals for tuition and renovation money. — [Simplifi ideas thread](https://community.simplifimoney.com/discussion/1357/link-from-transaction-to-take-from-savings-goal-1-merged-vote)
- A December 2025 request: "contributions and withdrawals from savings goals in Simplifi do not update cumulative totals, making it hard to track overall progress. Users have to manually adjust goal amounts when spending from the goal, which is confusing and error-prone." A reply: "the lack of this ability is a big part of why I don't use Savings Goals." Another user explains they use goals as sinking funds and want a "Spend from Goal" field on the transaction. — [Simplifi thread, Dec 2025](https://community.simplifimoney.com/discussion/15205/allow-transactions-to-link-directly-to-savings-goals)
- A related earlier request showed 64 votes, and a 2020 thread was closed with "This ability is forthcoming!" (snippet). — [Simplifi community comment](https://community.simplifimoney.com/discussion/comment/8217)

### Inferences
- Simplifi shows what happens when earmarks are disconnected from transactions: users treat goals as sinking funds anyway, then have to do a manual two-step (exclude the transaction from the plan, then withdraw the same amount from the goal). Five-plus years of votes show this does not go away.
- "Available balance" per account is the account-side equivalent of an envelope budget's "ready to assign"; it works but splits the truth across each account rather than one budget-wide number.

### Gaps
- No r/simplifimoney threads retrieved. Whether Simplifi shipped any 2026 change to goals was not confirmed; the thread status suggests not.

## Other budgeting apps with a distinctive pattern

### Takeaway
Outside the Monarch/Copilot/Simplifi "earmark account balances" family there are three other patterns: rollover budget lines that hold a balance (EveryDollar Funds, Lunch Money rollover categories, Goodbudget goal/annual envelopes, Tiller savings budget), goals bound one-to-one to an account (old Mint), and real-money products that move cash for you (Rocket Money, Qube).

### Cited Findings

**EveryDollar (Ramsey) Funds: a budget line with a carried balance**
- A Fund is a budget item with a current balance and optional target; the Planned amount is credited immediately: with $200 saved and $50 planned, "Your Fund balance will immediately show a $250 balance, regardless of whether or not you have physically made any changes within your bank account." — [How Funds Work With Your Budget](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/40362010062861-How-Funds-Work-With-Your-Budget)
- Spending is an ordinary expense transaction tracked to the Fund, which lowers the balance; the remainder "automatically rolls over month to month". — [How Funds Work With Your Budget](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/40362010062861-How-Funds-Work-With-Your-Budget)
- Transfers are not modelled: "delete both transfer transactions. EveryDollar is designed to track money coming in and going out, rather than money moving between your own bank accounts." — [How to Use Funds](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360037957712-How-to-Use-Funds)
- Reporting side effect: "Tracking expense transactions on a Fund will lower the Fund balance, but it will also lower your current month's remaining balance (throwing off your Insights page)." — [How to Use Funds](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360037957712-How-to-Use-Funds)
- Regular items cannot carry a negative remainder, but "Funds… carry over whatever the Remaining balance is from the previous month." Non-fund leftovers need a manual "Rollover" income line. — [How to Handle Unspent Money](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360038398771-How-to-Handle-Unspent-Money-in-Your-Budget)
- Editing a Fund's balance creates a "Balance Updated" transaction; the mobile-only Account Balancer lets users assign Funds to bank accounts and flags discrepancies between fund totals and the account balance. — [How to Edit Funds](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360037959792-How-to-Edit-Funds); [Funds and the Account Balancer](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/39335107682189-Funds-and-the-Account-Balancer)
- A newer mobile-only "target goal" feature adds a goal with amount and timeline that shows in the Savings (or Debt) group. — [Creating a Target Goal on Mobile](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/48315084266637-Creating-a-Target-Goal-on-Mobile)

**Lunch Money: no goals feature; rollover categories instead**
- The official recommendation is a category set to "Rollover to same category" with a starting balance and fixed monthly budget. Spending has two documented options: categorise the expense to the savings category (simple, but the expense is missing from its real category in reports), or categorise it properly and then "Move Money" from the savings category (accurate, one extra step). — [Lunch Money blog, posted 2026-03-13](https://lunchmoney.app/blog/how-to-track-savings-goals-with-rollovers)
- The "Savings and goals" request was posted by staff on 2021-01-12 and has 511 votes; the two use cases are 'By X date, I need Y set aside' and 'Save X amount every month'. 2026 commenters ask for the app to calculate the monthly amount from target, date and amount saved; one says he is staying with YNAB for that reason (as rendered by summarizer). — [Lunch Money feedback board](https://feedback.lunchmoney.app/general-feature-request/p/savings-and-goals)

**Goodbudget: goal and annual envelopes (snippet)**
- Annual envelopes spread a yearly amount across budget periods ($600 a year becomes $50 a month); goal envelopes divide a target by periods until the due date; the free plan allows 10 regular plus 10 goal/annual envelopes. — [Goodbudget blog](https://goodbudget.com/blog/2014/11/reach-your-savings-goals-with-goodbudget-on-the-web/); [Goodbudget getting started](https://goodbudget.com/help/getting-started-guide/step-1-add-envelopes/)

**Tiller and PocketSmith (snippet)**
- Tiller treats checking-to-savings as a transfer; to budget saving, its guidance is an expense-type category, and its Savings Budget template works independently of accounts so a goal's money can sit across several accounts. — [Tiller: understanding transfers](https://intercom.help/tiller/en/articles/432687-understanding-transfers); [Tiller community](https://community.tiller.com/t/how-to-track-contributions-transfers-to-a-savings-account/5839)
- PocketSmith excludes transfers from reports and has a documented option to view a transfer as an expense. — [PocketSmith: dealing with transfers](https://learn.pocketsmith.com/article/132-dealing-with-transfers-in-pocketsmith)

**Mint (retired): one goal per account (snippet)**
- Mint's help centre said more than one goal could not be linked to a single account because progress was measured from that account. Users in other forums said this made goals unusable when all savings sat in one account. — [Mint help](https://help.mint.com/Goals/888961581/Can-I-link-multiple-Goals-to-one-account.htm); [Simplifi community thread on 1:1 mapping](https://community.simplifimoney.com/discussion/584/1-1-map-a-savings-goal-to-an-account-edited); [Consumerism Commentary](https://consumerismcommentary.com/track-savings-goals-with-mint-com/)

**Real-money products (snippet)**
- Rocket Money Financial Goals (formerly Smart Savings) moves real money into a partner-bank account, either on autopilot based on balance and spending or on a user-set schedule; multiple goals are supported. — [Rocket Money help](https://help.rocketmoney.com/en/articles/2620940-financial-goals-overview)
- Qube Money groups its "qubes" into Bills, Spend and Goals and pairs them with a card using "Zero Default Technology". — [Qube FAQ](https://qubemoney.com/faqs/); [Money Crashers review](https://www.moneycrashers.com/qube-money-review/)

### Inferences
- EveryDollar Funds are the closest commercial analogue to an envelope category with rollover, and they avoid the goal-versus-account reconciliation entirely, then add an optional reconciliation aid (Account Balancer) on top. That ordering (budget-side truth first, account check second and optional) fits a zero-based app.
- Lunch Money's "approach A vs B" is the clearest statement of the reporting trade-off any design must settle: either the purchase is reported under "Savings/Vacation fund" or under its real category.
- EveryDollar's own warning that fund spending "throws off" monthly insights is the flow-report failure mode: spending from money saved in earlier months makes the current month look overspent unless reports distinguish it.

### Gaps
- Not researched: Empower/Personal Capital, Origin, Fina, Toshl, Wallet by BudgetBakers, Spendee, South-Asian Money Manager apps. Goodbudget, Qube, Tiller, PocketSmith, Mint and Rocket Money rest on search snippets only. Qube's default-zero card mechanics were not confirmed from a primary source.

## Bank-native buckets, pots, spaces and savers

### Takeaway
Bank sub-account features make the earmark real: money in a pot cannot be spent by the main card, which is the feature people like (visibility, automation at payday, round-ups, bills paid from a pot) and the reason envelope budgeters say it conflicts with a location-agnostic budget.

### Cited Findings
- Ally: up to 30 buckets inside one savings account; interest accrues on the whole account and is added to core savings unless directed to a bucket; "boosters" are automation (round-ups that sweep once $5 accrues, Surprise Savings, recurring transfers), not rate boosts (snippet). — [Ally savings FAQ](https://www.ally.com/help/bank/savings-money-market.html); [Ally buckets and boosters](https://ally.com/stories/save/what-are-ally-banks-savings-buckets-and-boosters); [NerdWallet](https://www.nerdwallet.com/banking/learn/savings-accounts-with-buckets)
- Monzo: round-ups go to a chosen pot; Salary Sorter splits incoming pay between spending, bills and savings pots; Direct Debits and standing orders can be paid from a pot (snippet). — [Monzo blog](https://monzo.com/blog/using-monzo-in-the-uk-after-holiday); [Monzo: Salary Sorter and Bills Pots (2019)](https://monzo-com-prod-ki2l2ylfnzdnlukejqwestn6ndy7faca.monzo.com/blog/2019/09/26/introducing-salary-sorter-and-bills-pots); [Monzo blog Oct 2021](https://monzo.com/blog/whats-new-in-monzo-october-2021)
- Monzo virtual cards linked to pots required the paid Plus tier as of 2021 (snippet). — [Which?](https://www.which.co.uk/news/2021/11/six-banking-app-features-that-can-help-you-keep-on-top-of-your-bills-and-subscriptions/)
- Starling: a virtual card can spend only what is in its Space, with no overdraft; up to five active cards. Bills Manager pays a bill only from the chosen Space and will not fall back to the main balance if the Space is short (snippet). — [Starling virtual cards](https://www.starlingbank.com/features/virtual-cards/); [Starling Bills Manager](https://starlingbank.com/blog/introducing-bills-manager)
- Up (Australia): up to 50 Savers, round-ups into a chosen Saver, automatic pay splitting on payday (snippet, company-reported). — [Up: how to start saving](https://up.com.au/blog/how-to-start-saving-with-up/); [Up round-ups](https://up.com.au/features/round-ups)
- N26 Spaces are sub-divisions of one account with targets, shared spaces and rules; bunq sub-accounts have their own IBANs; Revolut separates Pockets (routing bills and wages) from interest-bearing Vaults (snippet; affiliate-style aggregators, low reliability). — [Finder UK](https://www.finder.com/uk/current-accounts/banking-apps-with-savings-pots); [Flat Studio neobank UX analysis](https://www.flatstudio.co/blog/neobank-ux-patterns-daily-banking)

**How envelope budgeters combine them**
- Monzo community (Aug 2022): a YNAB-style approach in pots "can result in the constant moving of money"; "YNAB is 'location agnostic' where as Monzo is not"; "keeping Pots and Budgeting YNAB style isn't compatible"; advice to "avoid the Monzo budgeting features because it confuses things" when using YNAB (as rendered by summarizer). — [Monzo community: YNAB type Budgeting](https://community.monzo.com/t/ynab-type-budgeting/136919)
- Monzo community (May 2026), a YNAB user considering pots as a category-group layer was told "Monzo is not set up for a granular finance overview like YNAB" and "Stick with YNAB. Monzo isn't built for that." (as rendered by summarizer). — [Monzo community: moving from YNAB](https://community.monzo.com/t/moving-from-ynab-to-monzo-how-do-you-handle-category-groups/193443)
- Other reported setups (snippets): one account synced to YNAB with pots ignored; pots mirrored one-to-one as YNAB categories; pots added as separate on-budget accounts; pots kept only for interest and emergency money. A reported hazard is card payments declining when the main balance is short because Monzo does not draw on pots. — [Monzo community: using Monzo for budgeting take 2](https://community.monzo.com/t/using-monzo-for-budgeting-take-2/83795); [Monzo community: YNAB & Monzo](https://community.monzo.com/t/ynab-monzo/96232)
- A non-YNAB user's praise for pots: "The main feature which helped me was the ability to open 'pots' and even set certain direct debits to come out of pots." (Nov 2020, as rendered by summarizer). — [MoneySavingExpert forum](https://forums.moneysavingexpert.com/discussion/6217547/budgeting-with-ynab-or-monzo)
- r/ynab (2023-24, via search snippets of Reddit mirrors, not verified against the threads): users describe one savings account plus categories as "less hassle" than bank buckets, call bank buckets plus categories "unnecessary overhead", and one worries about having to "match" category totals to the savings balance. — [r/ynab mirror: how to save / best banking app](https://lr.eu.psf.lt/r/ynab/comments/1e5659e/how_to_save_best_banking_app/ldlgf2j/?context=3); [r/ynab mirror: avoiding the one big savings category](https://lr.eu.psf.lt/r/ynab/comments/1e7iesl/how_to_assign_savings_and_avoiding_the_one_big)

### Inferences
- For someone already running an envelope budget, bank buckets duplicate the earmark; the people who keep both tend to reduce pots to a few coarse ones (bills, emergency, interest) and let the budget carry the detail.
- The features that bank users praise are automation and enforcement at the point of payment (salary split, round-ups, bills paid from the pot, cards that cannot overspend a space). A budgeting app cannot enforce, but it can copy the visible parts: named goals, progress, automatic monthly funding.
- An open source envelope app should let a bank pot be modelled either as its own account or ignored inside a parent account, without requiring pots to map to categories.

### Gaps
- No official Monzo source on locked pots was retrieved (only a third-party guide). Capital One multiple accounts not researched. r/UKPersonalFinance not reachable. Maximum number of Monzo pots not confirmed.

## Cross-cutting: is saving a third kind of flow, are goals bound to accounts, and how are growth, completion and withdrawal handled?

### Takeaway
Flow-based budgets (Monarch, Copilot, Simplifi) treat saving as a third planned section and as the residual "income minus spending" in reports, so they need account-bound goals plus special handling for spending saved money. Balance-carrying budget lines (EveryDollar Funds, Lunch Money rollover, Goodbudget) keep goals virtual and need none of that, at the cost of weaker account reconciliation and muddier monthly reports.

### Cited Findings

| App | Goal attached to | Many goals per account / one goal across accounts | Contribution recorded as | Spending from goal | Saving in budget and reports | Growth / completion | Source |
|---|---|---|---|---|---|---|---|
| Monarch (Goals 3.0) | Allocation of real account balances | Yes / yes (or one account fully dedicated) | Manual allocation, linked income/transfer, or balance sync | Link expense; excluded from budget actuals; optional reduction of progress; card reconciliation | "Contributions" budget section; transfers excluded from cash flow; savings rate in reports | Adjustments excluded from budget; growth-rate projections; archive is reversible | [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals) |
| Copilot | Allocation of account balances and/or linked transactions | Implied yes / yes | Edit allocation or link incoming transaction | Link spending transaction; "Update Budgets on Spend" toggle | Goal money excluded from categories and spending total | Ready to Spend state; reactivate when funds dip; archive is permanent | [Spending from Savings Goals](https://help.copilot.money/en/articles/11100511-spending-from-savings-goals) |
| Simplifi | Virtual earmark on named accounts | Yes / yes | Manual contribution from a "take from" account | Manual withdrawal only; no transaction link | Reduces Available balance; contribution is a Spending Plan line | Completed section; no history | [Simplifi support](https://support.simplifi.quicken.com/en/articles/3676756-using-quicken-simplifi-s-savings-goals) |
| EveryDollar Funds | Budget line (not an account) | Not applicable; optional Account Balancer mapping | Planned amount credited immediately | Ordinary expense tracked to the fund | Fund sits in the budget; transfers deleted | Optional target; balance edits create a transaction | [How Funds Work](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/40362010062861-How-Funds-Work-With-Your-Budget) |
| Lunch Money | Rollover category | Not applicable | Monthly budget amount | Categorise to the fund, or categorise properly then Move Money | Category in budget | None built in | [Lunch Money blog](https://lunchmoney.app/blog/how-to-track-savings-goals-with-rollovers) |
| Mint (retired) | One real account | No / not confirmed | Account balance | Not applicable | Separate goals area | Not confirmed | [Mint help](https://help.mint.com/Goals/888961581/Can-I-link-multiple-Goals-to-one-account.htm) |
| Bank pots (Monzo, Starling, Ally, Up) | Real sub-balance | Bucket is the unit | Real transfer, salary split, round-up | Transfer out, pot-linked card, or bill paid from pot | Outside any budget | Interest per account (Ally) | [Ally FAQ](https://www.ally.com/help/bank/savings-money-market.html) |

- Monarch states the identity explicitly: "income = expenses + savings". — [Creating Your Budget in Monarch](https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch)
- Copilot states the same idea as a planning rule: the margin between income and total budget should be "reflective of your monthly savings goal total" (as rendered by summarizer). — [Savings with Copilot](https://help.copilot.money/en/articles/11471870-savings-with-copilot)
- Tiller and Quicken users are told to budget a savings transfer as an expense-type line, and a Quicken community thread is titled "Why is saving considered an expense" (snippet). — [Tiller community](https://community.tiller.com/t/transfers-to-savings-category/13244); [Quicken community](https://community.quicken.com/discussion/7903544/why-is-saving-considered-an-expense)

### Inferences
- Three distinct questions get conflated under "savings" and each app answers a different subset: (a) purpose: what is this money for (goal/envelope); (b) location: which account holds it; (c) flow: how much of this period's income was not spent (savings rate). Apps that bind (a) to (b) pay for it with reconciliation machinery; apps that ignore (b) get user requests for an account check (EveryDollar added Account Balancer); apps that show (c) must decide whether goal-funded spending counts against the month.
- Investment growth is the case where account binding is unavoidable: Monarch only handles it for fully dedicated accounts and keeps it out of the budget as "adjustments". For an envelope app this argues for treating growth on off-budget/tracking accounts as progress toward a goal without creating assignable money.
- Refillable versus one-off is a first-class distinction in both Monarch ("Spending reduces goal progress") and Copilot ("Reactivate when funds dip").

### Gaps
- How each app's savings rate is computed (whether goal contributions, transfers to investment accounts or payroll deductions count) was not confirmed. Repurposing a goal is documented only as moving allocations between goals in Monarch; no app's "rename and keep history" behaviour was confirmed.

## Evidence about what users want

### Takeaway
The best-evidenced demands are: spend a real transaction from a goal without it hitting the month's budget, an auditable history of what funded and drained a goal, and automatic calculation of the monthly amount from a target and date.

### Cited Findings
- Simplifi: "link a transaction to take from / add to a savings goal" has 274 votes, 72 comments, open since 2021-02-01, still "In Review". — [Simplifi ideas thread](https://community.simplifimoney.com/discussion/1357/link-from-transaction-to-take-from-savings-goal-1-merged-vote)
- Lunch Money: "Savings and goals" has 511 votes, open since 2021-01-12; requested fields are target amount, target date and amount already saved, with the monthly amount computed and the balance carried in the category (as rendered by summarizer). — [Lunch Money feedback board](https://feedback.lunchmoney.app/general-feature-request/p/savings-and-goals)
- Monarch says its redesign answered members who wanted "clearer tracking, better budget integration, and support for spending from credit cards and more account types". — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch)
- Copilot users ask for investment contributions to appear as saving and for goal timelines to include compound growth (snippet). — [Copilot roadmap](https://roadmap.copilot.money/feature-requests/p/investment-account-contributions-included-in-savings-view)
- Mint users objected to needing a separate bank account per goal (snippet). — [Consumerism Commentary](https://consumerismcommentary.com/track-savings-goals-with-mint-com/)

### Inferences
- The top request in two different apps (Simplifi, and implicitly Lunch Money's approach A/B) is something an envelope budget does natively: a purchase categorised to a funded envelope draws it down. The design risk for a zero-based app is therefore less the mechanism and more the reporting and the vocabulary (making it obvious that money in a savings category is saved, and that spending it is not "overspending this month").

### Gaps
- No "best app for savings goals" or "YNAB vs Monarch savings goals" Reddit threads could be read. No app-store review analysis was done. Monarch vote counts unavailable.

## Behavioural and UX research applicable to savings-goal design

### Takeaway
Field evidence supports labelling and partitioning money, suggests fewer simultaneous goals can raise saving, and shows that earmarks help most when paired with automatic deposits; most of it comes from small samples in low-income settings, so it is directional.

### Cited Findings
- Soman and Cheema (2011, Journal of Marketing Research): 146 households on a rural Indian construction project had earmarked savings sealed in envelopes weekly for 15 weeks; splitting the amount across two envelopes raised saving, and the lowest savers were those with a high target in a single envelope; some envelopes carried photos of the participants' children as a visual cue (snippet of the paper). — [Russell Sage-hosted PDF](https://www.russellsage.org/sites/default/files/u137/jmr-C-s014-s021-online.pdf)
- Soman and Zhao (Journal of Marketing Research): in a field study of 83 households in India, a single savings goal produced higher saving than multiple goals (single goal plus envelope saved roughly three times the control rate of about 3.5% of income); the effect disappeared when people were prompted to think about implementation, and multiple goals framed as serving one common goal did as well as a single goal. The World Bank reviewer calls it a proof of concept with small, non-random samples. — [World Bank Development Impact blog, 2011-10-17](https://blogs.worldbank.org/en/impactevaluations/marketing-saving-fewer-goals-can-lead-to-higher-savings)
- A Malawi field experiment with 481 urban entrepreneurs found offering multiple labelled accounts raised savings in the treatment accounts by about 30% (snippet). — [J-PAL paper: Saving for Multiple Financial Needs](https://povertyactionlab.org/media/file-research-paper/saving-multiple-financial-needs-evidence-malawi)
- Ashraf, Karlan and Yin's SEED commitment account in the Philippines restricted access with no interest advantage, and 28% of those offered it opened one (snippet). — [NBER-hosted PDF](https://users.nber.org/~rdehejia/!@$devo/Lecture%2007%20Savings/supplemental/Ashraff_Karland_Yinn_SEED.pdf)
- Dupas and Robinson's Kenya work is summarised as: earmarking alone, without a direct deposit or deposit-collection feature, is not enough to raise saving among time-inconsistent individuals; a secondary report cites the same authors for a simple safe place to keep money raising savings by up to 138% (snippet; exact source page not verified). — [Center for Advanced Hindsight / Mastercard report](https://advanced-hindsight.com/wp-content/uploads/2024/01/CCL-Mastercard-Report-4-Gliber-240109.pdf)
- Goal-gradient effect: Kivetz, Urminsky and Zheng (2006) found coffee-shop loyalty-card customers bought more frequently as they neared the reward (secondary marketing source only). — [Renascence summary](https://www.renascence.io/behavioral-biases/goal-gradient-effect)

### Inferences
- Named, separate goals are supported; an unbounded list of small goals may not be. Soman and Zhao's "multiple goals framed under one common goal" result suggests grouping (for example a "True expenses" or "Savings" group with a single headline number) as a mitigation.
- Dupas and Robinson's result maps to automation: a goal with an automatic monthly assignment is likely worth more than a label alone. This matches what bank users praise (salary sorter, round-ups).
- Progress display (goal gradient) is cheap and well-liked, but the evidence I retrieved for it is secondary.
- Commitment (locked pots) is something a bank can enforce and a budgeting app cannot; the nearest equivalent is friction or a warning when moving money out of a goal.

### Gaps
- Primary papers were not read in full; figures for Soman and Cheema's rupee totals (reported by a WEF summary) could not be verified. The SEED savings-increase effect size and Thaler's mental-accounting papers were not retrieved in this session. Kivetz et al. (2006, Journal of Marketing Research 43(1), doi 10.1509/jmkr.43.1.39) is cited from memory, not fetched. No UK evidence on locked pots (for example Nest Insight) was found.

## Synthesis: patterns users praise and patterns they complain about

### Takeaway
Users praise named goals with visible progress, automatic funding, and being able to spend saved money without the month looking overspent; they complain when goals are tied one-to-one to accounts, when goal balances are disconnected from transactions, and when two ledgers (goals and accounts, or pots and budget) have to be kept in agreement by hand.

### Cited Findings
- Praised: spending from saved funds without distorting the monthly budget (Monarch built it citing member feedback; Copilot ships a toggle for it; Simplifi users have asked for it since 2021). — [Goals in Monarch](https://help.monarch.com/hc/en-us/articles/44373110771860-Goals-in-Monarch); [Copilot](https://help.copilot.money/en/articles/11100511-spending-from-savings-goals); [Simplifi ideas thread](https://community.simplifimoney.com/discussion/1357/link-from-transaction-to-take-from-savings-goal-1-merged-vote)
- Praised: many goals inside one account (the lack of it was Mint's main goals complaint; Ally, Monzo, Up and Monarch all support it). — [Mint help](https://help.mint.com/Goals/888961581/Can-I-link-multiple-Goals-to-one-account.htm); [Ally FAQ](https://www.ally.com/help/bank/savings-money-market.html)
- Praised: automation at the bank (salary splitting, round-ups, bills from a pot). — [MoneySavingExpert forum](https://forums.moneysavingexpert.com/discussion/6217547/budgeting-with-ynab-or-monzo); [Up](https://up.com.au/blog/how-to-start-saving-with-up/)
- Complained about: no transaction link and no history (Simplifi: "confusing and error-prone"; "a big part of why I don't use Savings Goals"). — [Simplifi thread, Dec 2025](https://community.simplifimoney.com/discussion/15205/allow-transactions-to-link-directly-to-savings-goals)
- Complained about: balance-only tracking with no view of which transfers funded a goal (Monarch 3.0 at launch, per one reviewer). — [personal-finance-tools review](https://personal-finance-tools.pages.dev/blog/monarch-money-winter-2026-review)
- Complained about: running bank pots and an envelope budget together ("constant moving of money", "isn't compatible"). — [Monzo community](https://community.monzo.com/t/ynab-type-budgeting/136919)
- Complained about: no computed monthly amount for a dated target (Lunch Money, 511 votes). — [Lunch Money feedback board](https://feedback.lunchmoney.app/general-feature-request/p/savings-and-goals)
- Documented vendor-side failure modes: sign confusion when linking transfer legs, refunds on goal purchases, payroll deductions making the budget look over-allocated, migration breaking history (all Monarch); fund spending "throwing off" monthly insights (EveryDollar). — [Moving Funds](https://help.monarch.com/hc/en-us/articles/46420712538260-Moving-Funds-In-and-Out-of-Goals); [Using Save Up Goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals); [How to Use Funds](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360037957712-How-to-Use-Funds)

### Inferences
Design implications for a zero-based envelope app, in rough priority:
- Keep goals virtual (a category or a property of a category), not bound to accounts. Every account-bound design found needs reconciliation machinery, and the one-goal-per-account version (Mint) was disliked outright.
- Offer an optional, read-only account check (EveryDollar's Account Balancer idea: "these goals live in this account; the account holds X, the goals total Y") instead of making allocation to accounts mandatory.
- Make spending from a goal an ordinary categorised transaction, and make reports able to separate "spent from money saved in earlier periods" from "spent from this period's income", so a planned purchase does not read as overspending (the EveryDollar and Lunch Money failure mode).
- Distinguish refillable goals (emergency fund, sinking funds) from one-off goals (vacation), since two vendors arrived at this independently.
- Compute the monthly amount from target, date and amount saved, and show on track / ahead / behind.
- Count growth on tracking or investment accounts as goal progress without creating assignable money, mirroring Monarch's "adjustments are excluded from the budget".
- Treat a savings rate as a report (income minus spending over income), not as a budget mechanism, and state clearly whether assigning to savings categories counts as "saved".
- Keep a full activity history per goal; both Simplifi (never had it) and Monarch (lost it at migration, then rebuilt linking) show its absence is noticed.

### Gaps
- The synthesis leans on vendor documentation and ideas-forum votes more than on broad user sentiment, because Reddit was unreachable. Claims about what users "praise" are better evidenced for bank pots and for the spend-from-goal request than for Monarch or Copilot goals specifically.
- Several apps named in the brief were not covered (see the method notes at the top).
