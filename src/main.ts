import { Actor } from 'apify';
import {
chromium,
type Browser,
type BrowserContext,
type Locator,
type Page,
} from 'playwright';

interface Input {
startUrl: string;
authState: unknown;
maxPages?: number;
maxProfiles?: number;
}

interface Person {
imdbId: string;
name: string;
profileUrl: string;
discoveryPage: number;
}

interface DirectContactResult {
email: string | null;
raw: string | null;
status: 'found' | 'not_found' | 'no_copy_button' | 'no_email' | 'error';
error: string | null;
}

interface PersonRecord {
imdbId: string;
name: string;
profileUrl: string;
discoveryPage: number;
contactEmail: string;
contactUrl: null;
directContactRaw: string;
contactStatus: 'found';
error: null;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const IMDB_PRO_ORIGIN = 'https://pro.imdb.com';

const NAVIGATION_TIMEOUT = 120_000;
const PROFILE_TIMEOUT = 120_000;
const DIRECT_CONTACT_WAIT = 2_000;
const COPY_WAIT = 1_000;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function errorMessage(error: unknown): string {
if (error instanceof Error) {
return error.message;
}

```
return String(error);
```

}

function normalizeText(value: string | null | undefined): string {
return (value ?? '')
.replace(/\s+/g, ' ')
.trim();
}

function normalizeStartUrl(value: string): string {
return value
.trim()
.replace(/&/gi, '&');
}

function extractImdbId(href: string): string | null {
const match = href.match(//name/(nm\d+)/i);

```
return match ? match[1].toLowerCase() : null;
```

}

function extractEmail(value: string): string | null {
const match = value.match(
/[A-Z0-9._%+-]+@[A-Z0-9.-]+.[A-Z]{2,}/i,
);

```
return match ? match[0].trim() : null;
```

}

function parseAuthState(value: unknown): unknown {
if (typeof value !== 'string') {
return value;
}

```
const trimmed = value.trim();

if (!trimmed) {
    throw new Error('authState is empty.');
}

try {
    return JSON.parse(trimmed);
} catch (error) {
    throw new Error(
        `Could not parse authState JSON: ${errorMessage(error)}`,
    );
}
```

}

async function isVisible(locator: Locator): Promise<boolean> {
return locator.isVisible().catch(() => false);
}

async function findVisibleLocator(
page: Page,
selectors: string[],
): Promise<Locator | null> {
for (const selector of selectors) {
const locator = page.locator(selector);
const count = await locator.count().catch(() => 0);

```
    for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);

        if (await isVisible(candidate)) {
            return candidate;
        }
    }
}

return null;
```

}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

async function verifyAuthentication(
page: Page,
startUrl: string,
): Promise<void> {
console.log('Checking IMDbPro authentication...');

```
await page.goto(startUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT,
});

await page.waitForTimeout(3_000);

const finalUrl = page.url();
const title = await page.title().catch(() => '');

console.log(`AUTH URL: ${finalUrl}`);
console.log(`AUTH TITLE: ${title}`);

const lowerUrl = finalUrl.toLowerCase();
const lowerTitle = title.toLowerCase();

const looksLikeLogin =
    lowerUrl.includes('/signin') ||
    lowerUrl.includes('/login') ||
    lowerUrl.includes('/ap/signin') ||
    lowerTitle.includes('sign in') ||
    lowerTitle.includes('log in');

if (looksLikeLogin) {
    throw new Error(
        'IMDbPro authentication failed. The supplied authState appears to be unauthenticated or expired.',
    );
}

if (!lowerUrl.includes('pro.imdb.com')) {
    throw new Error(
        `IMDbPro authentication check reached an unexpected URL: ${finalUrl}`,
    );
}

console.log('IMDbPro authentication check passed.');
```

}

// -----------------------------------------------------------------------------
// Discovery
// -----------------------------------------------------------------------------

async function discoverPeople(
page: Page,
pageNumber: number,
baseUrl: string,
): Promise<Person[]> {
const url = new URL(baseUrl);

```
url.searchParams.set(
    'pageNumber',
    String(pageNumber),
);

console.log('\n==============================');
console.log(
    `OPENING DISCOVERY PAGE ${pageNumber}`,
);
console.log('==============================');

let loaded = false;

for (let attempt = 1; attempt <= 2; attempt++) {
    try {
        await page.goto(url.toString(), {
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT,
        });

        console.log('Waiting for IMDbPro results...');
        await page.waitForTimeout(5_000);

        loaded = true;
        break;
    } catch (error) {
        console.error(
            `Discovery page ${pageNumber}, attempt ${attempt} failed: ${errorMessage(error)}`,
        );

        if (attempt < 2) {
            await page.waitForTimeout(2_000);
        }
    }
}

if (!loaded) {
    throw new Error(
        `Could not load discovery page ${pageNumber}.`,
    );
}

console.log(`FINAL URL: ${page.url()}`);
console.log(`TITLE: ${await page.title().catch(() => '')}`);

const links = page.locator(
    'a[href*="/name/nm"]',
);

const count = await links.count();

console.log(
    `NAME LINKS FOUND ON PAGE ${pageNumber}: ${count}`,
);

const people: Person[] = [];
const pageIds = new Set<string>();

for (let i = 0; i < count; i++) {
    const link = links.nth(i);

    const href = await link
        .getAttribute('href')
        .catch(() => null);

    if (!href) {
        continue;
    }

    const imdbId = extractImdbId(href);

    if (!imdbId || pageIds.has(imdbId)) {
        continue;
    }

    pageIds.add(imdbId);

    const profileUrl = new URL(
        href,
        page.url(),
    ).toString();

    const name =
        normalizeText(
            await link.innerText().catch(() => ''),
        ) || imdbId;

    people.push({
        imdbId,
        name,
        profileUrl,
        discoveryPage: pageNumber,
    });
}

console.log(
    `UNIQUE PEOPLE FOUND ON PAGE ${pageNumber}: ${people.length}`,
);

return people;
```

}

// -----------------------------------------------------------------------------
// Direct Contact UI
// -----------------------------------------------------------------------------

async function getDirectContactControl(
page: Page,
): Promise<Locator | null> {
return findVisibleLocator(page, [
'button:has-text("Direct Contact")',
'[role="button"]:has-text("Direct Contact")',
'a:has-text("Direct Contact")',
'[aria-label*="Direct Contact" i]',
'[title*="Direct Contact" i]',
]);
}

async function getCopyButtonWithin(
container: Locator,
): Promise<Locator | null> {
const selectors = [
'button[aria-label*="copy" i]',
'[role="button"][aria-label*="copy" i]',
'button[title*="copy" i]',
'[role="button"][title*="copy" i]',
'button[data-testid*="copy" i]',
'[role="button"][data-testid*="copy" i]',
'button:has-text("Copy")',
'[role="button"]:has-text("Copy")',
'button:has(svg[aria-label*="copy" i])',
'button:has(svg[title*="copy" i])',
'[role="button"]:has(svg[aria-label*="copy" i])',
'[role="button"]:has(svg[title*="copy" i])',
];

```
for (const selector of selectors) {
    const locator = container.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);

        if (await isVisible(candidate)) {
            return candidate;
        }
    }
}

return null;
```

}

async function findDirectContactContainer(
directContactControl: Locator,
): Promise<{
container: Locator;
copyButton: Locator;
} | null> {
/*
* IMPORTANT:
*
* We intentionally walk upward from the Direct Contact control.
* We never search the entire page for a copy button.
*
* This prevents a copy button belonging to an agent, manager,
* representative, company, or another contact section from being used.
*/

```
for (let level = 1; level <= 8; level++) {
    const container =
        directContactControl.locator(
            `xpath=ancestor::*[${level}]`,
        );

    const count = await container.count().catch(() => 0);

    if (count === 0) {
        continue;
    }

    const text = normalizeText(
        await container
            .innerText()
            .catch(() => ''),
    );

    if (!/direct\s+contact/i.test(text)) {
        continue;
    }

    const copyButton =
        await getCopyButtonWithin(container);

    if (copyButton) {
        return {
            container,
            copyButton,
        };
    }
}

return null;
```

}

// -----------------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------------

async function clearClipboard(
page: Page,
): Promise<boolean> {
try {
const cleared = await page.evaluate(async () => {
try {
await navigator.clipboard.writeText('');
return true;
} catch {
return false;
}
});

```
    return cleared;
} catch {
    return false;
}
```

}

async function readClipboard(
page: Page,
): Promise<string> {
try {
const text = await page.evaluate(async () => {
try {
return await navigator.clipboard.readText();
} catch {
return '';
}
});

```
    return normalizeText(text);
} catch {
    return '';
}
```

}

// -----------------------------------------------------------------------------
// Direct Contact Extraction
// -----------------------------------------------------------------------------

async function extractDirectContact(
page: Page,
): Promise<DirectContactResult> {
try {
const directContactControl =
await getDirectContactControl(page);

```
    if (!directContactControl) {
        console.log(
            'DIRECT CONTACT: section not found. Nothing will be saved.',
        );

        return {
            email: null,
            raw: null,
            status: 'not_found',
            error: null,
        };
    }

    console.log(
        'DIRECT CONTACT: control found.',
    );

    /*
     * Find the Direct Contact container BEFORE clicking.
     * This gives us the exact section to which the copy button
     * must belong.
     */
    let directContainer =
        await findDirectContactContainer(
            directContactControl,
        );

    if (!directContainer) {
        console.log(
            'DIRECT CONTACT: scoped copy button not found before opening.',
        );
    }

    console.log(
        'DIRECT CONTACT: opening section...',
    );

    await directContactControl.click({
        timeout: 15_000,
    });

    await page.waitForTimeout(
        DIRECT_CONTACT_WAIT,
    );

    /*
     * Re-find the container after opening because IMDbPro can
     * replace or re-render the contact DOM.
     */
    directContainer =
        await findDirectContactContainer(
            directContactControl,
        );

    if (!directContainer) {
        console.log(
            'DIRECT CONTACT: could not identify a container containing its own copy button.',
        );

        return {
            email: null,
            raw: null,
            status: 'no_copy_button',
            error: null,
        };
    }

    let copyButton =
        directContainer.copyButton;

    if (!copyButton) {
        await page.waitForTimeout(COPY_WAIT);

        const refreshed =
            await findDirectContactContainer(
                directContactControl,
            );

        if (refreshed) {
            copyButton = refreshed.copyButton;
        }
    }

    if (!copyButton) {
        console.log(
            'DIRECT CONTACT: copy button not found. Nothing will be saved.',
        );

        return {
            email: null,
            raw: null,
            status: 'no_copy_button',
            error: null,
        };
    }

    console.log(
        'DIRECT CONTACT: scoped copy button found.',
    );

    /*
     * Clear the clipboard first.
     *
     * If we cannot clear it, we refuse to trust clipboard data
     * because it could be left over from a previous profile.
     */
    const clipboardCleared =
        await clearClipboard(page);

    if (!clipboardCleared) {
        console.log(
            'DIRECT CONTACT: could not clear clipboard. Refusing to use possibly stale clipboard data.',
        );

        return {
            email: null,
            raw: null,
            status: 'no_email',
            error: 'Could not clear clipboard before copying.',
        };
    }

    console.log(
        'DIRECT CONTACT: clicking copy button...',
    );

    await copyButton.click({
        timeout: 15_000,
    });

    await page.waitForTimeout(750);

    const clipboardText =
        await readClipboard(page);

    console.log(
        `DIRECT CONTACT: clipboard length = ${clipboardText.length}`,
    );

    if (!clipboardText) {
        console.log(
            'DIRECT CONTACT: clipboard was empty. Nothing will be saved.',
        );

        return {
            email: null,
            raw: null,
            status: 'no_email',
            error: null,
        };
    }

    /*
     * IMPORTANT:
     *
     * The ONLY source used for the email is the clipboard produced
     * by the Direct Contact copy button.
     *
     * We do NOT inspect:
     * - agent emails
     * - manager emails
     * - representative emails
     * - company emails
     * - arbitrary page text
     * - arbitrary mailto links
     */
    const email =
        extractEmail(clipboardText);

    if (!email) {
        console.log(
            'DIRECT CONTACT: copied content contains no valid email. Nothing will be saved.',
        );

        return {
            email: null,
            raw: clipboardText,
            status: 'no_email',
            error: null,
        };
    }

    console.log(
        `DIRECT CONTACT EMAIL CONFIRMED: ${email}`,
    );

    return {
        email,
        raw: clipboardText,
        status: 'found',
        error: null,
    };
} catch (error) {
    const message =
        errorMessage(error);

    console.error(
        `DIRECT CONTACT ERROR: ${message}`,
    );

    return {
        email: null,
        raw: null,
        status: 'error',
        error: message,
    };
}
```

}

// -----------------------------------------------------------------------------
// Profile Processing
// -----------------------------------------------------------------------------

async function processProfile(
page: Page,
person: Person,
): Promise<PersonRecord | null> {
console.log('\n------------------------------');
console.log(
`PROCESSING: ${person.name} (${person.imdbId})`,
);
console.log('------------------------------');

```
try {
    await page.goto(person.profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PROFILE_TIMEOUT,
    });

    await page.waitForTimeout(3_000);

    console.log(
        `PROFILE URL: ${page.url()}`,
    );

    const currentUrl =
        page.url().toLowerCase();

    if (
        currentUrl.includes('/signin') ||
        currentUrl.includes('/login') ||
        currentUrl.includes('/ap/signin')
    ) {
        throw new Error(
            'IMDbPro authentication expired or profile redirected to login.',
        );
    }

    const contact =
        await extractDirectContact(page);

    if (
        contact.status !== 'found' ||
        !contact.email
    ) {
        console.log(
            `NO DIRECT CONTACT EMAIL: ${person.imdbId}. Nothing pushed to dataset.`,
        );

        return null;
    }

    const record: PersonRecord = {
        imdbId: person.imdbId,
        name: person.name,
        profileUrl: person.profileUrl,
        discoveryPage: person.discoveryPage,
        contactEmail: contact.email,
        contactUrl: null,
        directContactRaw: contact.raw ?? '',
        contactStatus: 'found',
        error: null,
    };

    /*
     * IMMEDIATE SAVE.
     *
     * Do not collect records in an array and save them later.
     * This is deliberately awaited so the result reaches the
     * Apify Dataset immediately after a successful copy.
     */
    await Actor.pushData(record);

    console.log(
        `SAVED DIRECT CONTACT: ${contact.email}`,
    );

    return record;
} catch (error) {
    console.error(
        `ERROR PROCESSING ${person.imdbId}: ${errorMessage(error)}`,
    );

    /*
     * Per the requirement, errors and missing Direct Contact
     * NEVER create dataset rows.
     */
    return null;
}
```

}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

await Actor.init();

let browser: Browser | null = null;
let context: BrowserContext | null = null;

try {
const input =
(await Actor.getInput()) as Input | null;

```
if (!input) {
    throw new Error(
        'Actor input is missing.',
    );
}

if (
    !input.startUrl ||
    typeof input.startUrl !== 'string'
) {
    throw new Error(
        'startUrl is required.',
    );
}

if (
    input.authState === undefined ||
    input.authState === null ||
    input.authState === ''
) {
    throw new Error(
        'authState is required.',
    );
}

const startUrl =
    normalizeStartUrl(input.startUrl);

const authState =
    parseAuthState(input.authState);

const maxPages = Math.max(
    0,
    Number(input.maxPages ?? 0),
);

const maxProfiles = Math.max(
    0,
    Number(input.maxProfiles ?? 0),
);

const startUrlObject =
    new URL(startUrl);

const startingPage = Math.max(
    1,
    Number(
        startUrlObject.searchParams.get(
            'pageNumber',
        ) ?? '1',
    ) || 1,
);

console.log('\n==============================');
console.log('IMDbPro DIRECT CONTACT SCRAPER');
console.log('==============================');

console.log(
    `Start URL: ${startUrl}`,
);

console.log(
    `Starting page: ${startingPage}`,
);

console.log(
    `Maximum pages: ${
        maxPages === 0
            ? 'UNLIMITED'
            : maxPages
    }`,
);

console.log(
    `Maximum profiles: ${
        maxProfiles === 0
            ? 'UNLIMITED'
            : maxProfiles
    }`,
);

console.log(
    'Direct Contact limit: NONE',
);

console.log(
    'Dataset behavior: SAVE IMMEDIATELY AFTER EACH VALID DIRECT CONTACT',
);

// -------------------------------------------------------------------------
// Browser
// -------------------------------------------------------------------------

browser =
    await chromium.launch({
        headless: true,
    });

context =
    await browser.newContext({
        storageState: authState as any,
        viewport: {
            width: 1920,
            height: 1080,
        },
    });

/*
 * Clipboard permissions are granted specifically for IMDbPro.
 */
await context.grantPermissions(
    [
        'clipboard-read',
        'clipboard-write',
    ],
    {
        origin: IMDB_PRO_ORIGIN,
    },
);

// -------------------------------------------------------------------------
// Authentication
// -------------------------------------------------------------------------

const authPage =
    await context.newPage();

try {
    await verifyAuthentication(
        authPage,
        startUrl,
    );
} finally {
    await authPage.close().catch(() => undefined);
}

// -------------------------------------------------------------------------
// Pages
// -------------------------------------------------------------------------

const discoveryPage =
    await context.newPage();

const profilePage =
    await context.newPage();

// -------------------------------------------------------------------------
// Counters
// -------------------------------------------------------------------------

const seenImdbIds =
    new Set<string>();

let totalDiscovered = 0;
let totalProcessed = 0;
let totalSaved = 0;
let pageNumber = startingPage;

// -------------------------------------------------------------------------
// Pagination
// -------------------------------------------------------------------------

while (
    maxPages === 0 ||
    pageNumber < startingPage + maxPages
) {
    const people =
        await discoverPeople(
            discoveryPage,
            pageNumber,
            startUrl,
        );

    if (people.length === 0) {
        console.log(
            `No people found on page ${pageNumber}. Stopping pagination.`,
        );

        break;
    }

    totalDiscovered += people.length;

    for (const person of people) {
        /*
         * Do not process the same IMDb person twice if IMDbPro
         * repeats a profile on different discovery pages.
         */
        if (seenImdbIds.has(person.imdbId)) {
            continue;
        }

        if (
            maxProfiles > 0 &&
            totalProcessed >= maxProfiles
        ) {
            console.log(
                `Reached configured profile limit: ${maxProfiles}`,
            );

            break;
        }

        seenImdbIds.add(person.imdbId);

        totalProcessed++;

        const saved =
            await processProfile(
                profilePage,
                person,
            );

        if (saved) {
            totalSaved++;
        }

        console.log(
            `PROGRESS: processed=${totalProcessed}, saved=${totalSaved}`,
        );
    }

    if (
        maxProfiles > 0 &&
        totalProcessed >= maxProfiles
    ) {
        console.log(
            `Reached configured profile limit: ${maxProfiles}.`,
        );

        break;
    }

    pageNumber++;
}

console.log('\n==============================');
console.log('SCRAPER FINISHED');
console.log('==============================');

console.log(
    `Pages processed: ${
        pageNumber - startingPage
    }`,
);

console.log(
    `People discovered: ${totalDiscovered}`,
);

console.log(
    `Profiles processed: ${totalProcessed}`,
);

console.log(
    `Direct Contact emails saved: ${totalSaved}`,
);

console.log(
    'Only successfully copied Direct Contact emails were written to the dataset.',
);
```

} catch (error) {
console.error(
`FATAL ACTOR ERROR: ${errorMessage(error)}`,
);

```
throw error;
```

} finally {
if (context) {
await context.close().catch(() => undefined);
}

```
if (browser) {
    await browser.close().catch(() => undefined);
}

await Actor.exit();
```

}
