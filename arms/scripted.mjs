export const RECIPES = {
  "directory-search": [{ action: "goto", path: "/" }, { action: "fill", selector: "input[type=search]", value: "agency" }, { action: "press", selector: "input[type=search]", key: "Enter" }, { action: "text", selector: "body" }],
  "directory-filter": [{ action: "goto", path: "/" }, { action: "click", selector: "text=Developer Tools" }, { action: "text", selector: "body" }],
  "directory-detail": [{ action: "goto", path: "/" }, { action: "click", selector: "text=Vercel" }, { action: "text", selector: "body" }],
  "blog-find-post": [{ action: "goto", path: "/" }, { action: "text", selector: "body" }],
  "blog-read-author": [{ action: "goto", path: "/about" }, { action: "text", selector: "body" }],
  "react-public-content": [{ action: "goto", path: "/" }, { action: "text", selector: "body" }],
  "react-auth-boundary": [{ action: "goto", path: "/app" }, { action: "text", selector: "body" }],
};

export async function run({ task, capsule, page }) {
  const recipe = task.recipe ?? RECIPES[task.id];
  if (!recipe) return { finalText: `Skipped: no scripted recipe for ${task.id}`, transcript: [{ action: "skip", taskId: task.id }] };
  const transcript = [];
  let finalText = "";
  for (const step of recipe) {
    if (step.action === "goto") await page.goto(new URL(step.path, capsule.baseUrl).href);
    else if (step.action === "fill") await page.locator(step.selector).fill(step.value);
    else if (step.action === "click") await page.locator(step.selector).click();
    else if (step.action === "press") await page.locator(step.selector).press(step.key);
    else if (step.action === "text") finalText = await page.locator(step.selector).innerText();
    else if (step.action === "title") finalText = await page.title();
    else throw new Error(`unknown scripted action: ${step.action}`);
    transcript.push(step);
  }
  return { finalText, transcript };
}
