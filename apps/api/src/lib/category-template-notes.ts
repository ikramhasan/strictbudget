// Notes a template import puts on its categories. They live apart from the generated
// `category-template-data.ts` so regenerating that file never touches them; they're keyed by
// template id and category name, and a test checks every "📋 About This Template" category in the
// data still has one.

/** What each template's "📋 About This Template" category explains, by template id. */
const ABOUT: Readonly<Record<string, string>> = {
  adhd: "Built for brains that forget and buy on impulse. Fund Bills and Frequent first, then give the ADHD Tax categories enough to cover late fees, lost things and forgotten renewals without guilt. Health & Meds and Quality of Life keep the things that help you function paid for.",
  "back-to-school":
    "Everything a new school year asks for, in one group. Start a few months ahead and set aside a little each month so supplies, clothes and fees are covered when the list arrives.",
  "buying-a-home":
    "Save for the costs around buying, not just the down payment: inspections, closing costs, moving and the first fixes. Fund the down payment steadily and top up the rest as the purchase gets closer.",
  college:
    "A student budget in four parts: everyday spending, the essentials of living away from home, school costs and some fun. Fill the essentials when money comes in (a paycheck, a loan or help from family), then spread the rest over the term.",
  divorce:
    "For setting up life on your own. Needs covers the new household, legal costs and anything you now pay alone. Self-Kindness keeps room for looking after yourself, and Situational holds one-off costs as they come up. Adjust as things settle.",
  family:
    "The day-to-day costs of raising kids in one place. Keep the regular ones (childcare, school, activities) funded first, and save a little each month for clothes, birthdays and the costs that catch you out.",
  food: "Split the food budget into where the money really goes. Seeing groceries, eating out, coffee and snacks apart makes it easier to choose which one to cut back when you need to.",
  happiness:
    "Small, planned spending on the things that make your days better. Pick the ones that matter to you, give each a little every month and spend it without second-guessing. Delete the rest.",
  christmas:
    "Plan the holidays all year. Divide what you expect to spend by the months left and set that aside each month, so gifts, food, travel and decorations are paid for before December.",
  "home-project":
    "Plan a renovation by what it costs: labour, materials, appliances, fixtures and decor, plus a buffer for surprises. Fill in the amounts from your quotes and track each part as the bills come in.",
  "house-projects-queue":
    "A running list of projects around the house. Fund the one at the top until it's done, then move on to the next. Reorder the list as priorities change.",
  "job-layoff":
    "For the time between jobs. Protect the essentials first, keep what the job search needs funded, and use What's Next for the costs of starting again. Assign only the money you have now, and stretch it as far as it needs to go.",
  kid: "A simple first budget for a child: some to spend, some to save and some to give. Each time money comes in, split it between the jars together and talk about the choices.",
  "kitchen-remodel":
    "Every part of a new kitchen, from cabinets and counters to appliances and labour. Use your quotes for the amounts, save toward the total, and keep a little extra for the things you find once the old kitchen comes out.",
  minimalist:
    "A few broad categories for when you want a simple plan. Give every dollar a job here first; split a category up later only if you need to see more detail.",
  "new-baby":
    "Get ready for a new baby: gear, medical bills, clothes and the first months at home. Start saving early so the big purchases are covered before the due date.",
  "new-car":
    "Save for the car and for what owning it costs: taxes, registration, insurance, upkeep. Funding these ahead means the purchase doesn't leave you short afterwards.",
  "new-puppy":
    "Fur Baby covers getting a dog home (adoption, first vet visits, supplies). Ongoing Puppy covers the regular costs after that: food, care and the vet visits to come.",
  "new-years-resolutions":
    "Give each goal for the year its own category so it gets money, not just intention. Fund a little every month and look back on how far each one has come.",
  "non-monthly-expenses":
    "Bills and costs that don't come every month. For each one, divide the yearly cost by twelve and set that aside monthly, so it's already there when the bill arrives.",
  "party-planning":
    "Everything a party needs, from the venue to the favours. Fill in what you expect each part to cost and save toward the date.",
  "recently-graduated":
    "Set up life after school: the monthly bills, the costs that come once or twice a year, and savings to build a cushion. Fund the monthly ones first, then work toward the others.",
  "small-business":
    "Keep the business's money apart from your own. Cost of the Work and Running the Business cover what the business spends, Paying Myself is your pay, and Hands Off! holds money that isn't yours to spend, like taxes.",
  "teach-budgeting":
    "An example plan for showing someone how this works. Walk through the monthly bills first, then the costs that don't come every month, then goals, giving every dollar a job as you go.",
  teen: "A teenager's own budget. My Expenses covers what they pay for, the Wish Farm saves for things they want soon, and Someday! is for the bigger goals further off.",
  travel:
    "Plan a trip by its parts: getting there, where to stay, food and things to do. Save toward the total before you go, so the trip is paid for when you come home.",
  wedding:
    "The parts of a wedding in their own groups, from the ceremony and reception to the week itself. Fill in your estimates, decide what matters most, and keep a buffer for the extras.",
  "wish-farm":
    "Save for the things you want. Wish Farm holds the treats you're saving for now; Wish List is for later. Move a wish up when the one before it is funded.",
  "beginner-template":
    "A first plan for giving every dollar a job. Start with the monthly bills, then fun, debt and kids, then save a little each month for the yearly costs and your goals. Delete what doesn't apply.",
};

/** Notes on other template categories, by template id, then category name. None yet. */
const NOTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

/** The category is "📋 About This Template", sometimes without the space. */
export const isAboutCategory = (name: string) => /^📋\s*About This Template$/.test(name);

/** The note a template's category is imported with, if it has one. */
export function templateCategoryNote(templateId: string, categoryName: string): string | null {
  if (isAboutCategory(categoryName)) return ABOUT[templateId] ?? null;
  return NOTES[templateId]?.[categoryName] ?? null;
}
