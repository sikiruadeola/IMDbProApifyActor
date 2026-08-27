import { test, expect } from '@playwright/test';

const START_URL =
  'https://pro.imdb.com/discover/people?creditCategoryId=amzn1.imdb.concept.name_credit_category.ace5cb4c-8708-4238-9542-04641e7c8171&hasEmploymentTrait=false&hasRepresentationTrait=false&hasCreditTrait=true&hasPerformanceTrait=false&hasActingTrait=false&hasMusicTrait=false&hasCreditCategoryRoles=true&profession=amzn1.imdb.concept.profession_category.c718155c-36c1-42ef-84ce-5dcb731e09b3&sortOrder=RELEVANCE&pageNumber=1&minNumOfReleasedCredits=1&creditBeginYear=2021&starMeterRangeMin=500000';

test.use({
  storageState: 'imdb-auth-state.json',
});

test('IMDbPro - authenticated access test', async ({ page }) => {
  await page.goto(START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  await page.waitForTimeout(8_000);

  console.log('FINAL URL:', page.url());
  console.log('TITLE:', await page.title());

  // Confirm authentication.
  await expect(page.getByText('Log out', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // Inspect the actual DOM for links that point to IMDbPro people pages.
  const peopleLinks = await page.locator('a[href*="/name/"]').evaluateAll((links) =>
    links.map((link) => ({
      text: (link.textContent || '').trim().replace(/\s+/g, ' '),
      href: (link as HTMLAnchorElement).href,
    }))
  );

  console.log('PEOPLE LINKS FOUND:', peopleLinks.length);

  for (const person of peopleLinks.slice(0, 30)) {
    console.log('PERSON:', JSON.stringify(person));
  }

  // Save useful diagnostics.
  const html = await page.locator('body').innerHTML();
  console.log('BODY HTML LENGTH:', html.length);

  await page.screenshot({
    path: 'imdbpro-results.png',
    fullPage: true,
  });

  await page.locator('body').evaluate((body) => {
    console.log(
      'VISIBLE LINKS:',
      Array.from(body.querySelectorAll('a'))
        .map((a) => ({
          text: (a.textContent || '').trim().replace(/\s+/g, ' '),
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((x) => x.text || x.href)
        .slice(0, 100)
    );
  });

  expect(page.url()).toContain('pro.imdb.com');
});