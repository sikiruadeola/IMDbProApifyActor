import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
    type Locator,
} from 'playwright';
import fs from 'node:fs';

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
}

interface PersonRecord {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
    contactEmail: string | null;
    contactUrl: string | null;
    directContactRaw: string | null;
    contactStatus: 'found' | 'not_found' | 'error';
    error: string | null;
}

interface ContactResult {
    email: string | null;
    url: string | null;
    raw: string | null;
    status: 'found' | 'not_found' | 'error';
    error: string | null;
}

interface Progress {
    lastCompletedPage: number;
    totalPeopleDiscovered: number;
    totalPeopleProcessed: number;
    totalPeopleWithContact: number;
    updatedAt: string;
}

interface Input {
    startUrl: string;
    maxPages?: number;
    maxDirectors?: number;
}

const STORAGE_FILE = './imdb-auth-state.json';
const PROGRESS_KEY = 'SCRAPER_PROGRESS';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function extractImdbId(href: string): string | null {
    const match = href.match(/\/name\/(nm\d+)/i);
    return match ? match[1] : null;
}

function extractEmail(text: string): string | null {
    const match = text.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match ? match[0].trim() : null;
}

function extractUrl(text: string): string | null {
    const match = text.match(
        /https?:\/\/[^\s<>"']+/i,
    );

    if (!match) {
        return null;
    }

    return match[0]
        .replace(/[),.;]+$/, '')
        .trim();
}

function getPageNumberFromUrl(urlString: string): number {
    const url = new URL(urlString);

    const pageNumber = Number(
        url.searchParams.get('pageNumber') ?? '1',
    );

    if (
        !Number.isFinite(pageNumber)
        || pageNumber < 1
    ) {
        return 1;
    }

    return Math.floor(pageNumber);
}

function getUrlForPage(
    startUrl: string,
    pageNumber: number,
): string {
    const url = new URL(startUrl);

    url.searchParams.set(
        'pageNumber',
        String(pageNumber),
    );

    return url.toString();
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

        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);

            if (await isVisible(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

// -----------------------------------------------------------------------------
// IMDbPro Direct Contact UI
// -----------------------------------------------------------------------------

async function getDirectContactButton(
    page: Page,
): Promise<Locator | null> {
    return findVisibleLocator(page, [
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',
        'text=Direct Contact',
    ]);
}

async function getCopyButton(
    page: Page,
): Promise<Locator | null> {
    return findVisibleLocator(page, [
        'button:has-text("Copy")',
        '[role="button"]:has-text("Copy")',
        'button[aria-label*="Copy" i]',
        '[role="button"][aria-label*="Copy" i]',
        'button[title*="Copy" i]',
        '[role="button"][title*="Copy" i]',
    ]);
}

// -----------------------------------------------------------------------------
// Extract Direct Contact
// -----------------------------------------------------------------------------

async function getDirectContact(
    page: Page,
): Promise<ContactResult> {
    try {
        const directContactButton =
            await getDirectContactButton(page);

        if (!directContactButton) {
            console.log(
                'Direct Contact button not found on this profile.',
            );

            return {
                email: null,
                url: null,
                raw: null,
                status: 'not_found',
                error: null,
            };
        }

        console.log(
            'Direct Contact button found. Opening Direct Contact...',
        );

        await directContactButton.click({
            timeout: 15_000,
        });

        await page.waitForTimeout(1_500);

        // ---------------------------------------------------------------------
        // Locate Direct Contact dialog/content.
        // ---------------------------------------------------------------------

        let dialog: Locator | null =
            await findVisibleLocator(page, [
                '[role="dialog"]',
                '[aria-modal="true"]',
                '[data-testid*="contact" i]',
            ]);

        if (!dialog) {
            await page.waitForTimeout(1_000);

            dialog = await findVisibleLocator(page, [
                '[role="dialog"]',
                '[aria-modal="true"]',
                '[data-testid*="contact" i]',
            ]);
        }

        // ---------------------------------------------------------------------
        // Try Copy button.
        // ---------------------------------------------------------------------

        let copyButton =
            await getCopyButton(page);

        if (!copyButton) {
            console.log(
                'Copy button not immediately available. Waiting...',
            );

            await page.waitForTimeout(2_000);

            copyButton =
                await getCopyButton(page);
        }

        let clipboardText = '';

        if (copyButton) {
            console.log(
                'Copy button found. Clicking it...',
            );

            try {
                await copyButton.click({
                    timeout: 10_000,
                });

                await page.waitForTimeout(500);

                clipboardText =
                    await page.evaluate(async () => {
                        try {
                            return await navigator.clipboard.readText();
                        } catch {
                            return '';
                        }
                    });

                clipboardText =
                    normalizeText(clipboardText);

                if (clipboardText) {
                    console.log(
                        `Clipboard content found: ${clipboardText}`,
                    );
                }
            } catch (error) {
                console.warn(
                    `Copy/read failed: ${getErrorMessage(error)}`,
                );
            }
        } else {
            console.log(
                'Copy button was not found.',
            );
        }

        // ---------------------------------------------------------------------
        // Read visible contact content.
        // ---------------------------------------------------------------------

        let visibleText = '';

        if (dialog) {
            visibleText =
                normalizeText(
                    await dialog
                        .innerText()
                        .catch(() => ''),
                );
        }

        if (!visibleText) {
            visibleText =
                normalizeText(
                    await page
                        .locator('body')
                        .innerText()
                        .catch(() => ''),
                );
        }

        // ---------------------------------------------------------------------
        // Extract links.
        // ---------------------------------------------------------------------

        const linkRoot =
            dialog ?? page.locator('body');

        const links =
            linkRoot.locator('a[href]');

        const linkCount =
            await links.count().catch(() => 0);

        const hrefs: string[] = [];

        for (let i = 0; i < linkCount; i++) {
            const href =
                await links
                    .nth(i)
                    .getAttribute('href')
                    .catch(() => null);

            if (href) {
                hrefs.push(href);
            }
        }

        // ---------------------------------------------------------------------
        // Combine all available contact sources.
        // ---------------------------------------------------------------------

        const combinedText = [
            clipboardText,
            visibleText,
            hrefs.join('\n'),
        ]
            .filter(Boolean)
            .join('\n');

        const email =
            extractEmail(combinedText);

        let contactUrl =
            extractUrl(combinedText);

        if (!contactUrl) {
            for (const href of hrefs) {
                if (
                    /^https?:\/\//i.test(href)
                ) {
                    contactUrl = href;
                    break;
                }
            }
        }

        if (
            email
            || contactUrl
            || clipboardText
        ) {
            console.log(
                'Direct Contact information found.',
            );

            return {
                email,
                url: contactUrl,
                raw:
                    clipboardText
                    || combinedText
                    || null,
                status: 'found',
                error: null,
            };
        }

        console.log(
            'Direct Contact was opened, but no usable contact information was found.',
        );

        return {
            email: null,
            url: null,
            raw: null,
            status: 'not_found',
            error: null,
        };
    } catch (error) {
        return {
            email: null,
            url: null,
            raw: null,
            status: 'error',
            error: getErrorMessage(error),
        };
    }
}

// -----------------------------------------------------------------------------
// Close Direct Contact
// -----------------------------------------------------------------------------

async function closeDirectContactIfOpen(
    page: Page,
): Promise<void> {
    const closeButton =
        await findVisibleLocator(page, [
            'button[aria-label*="Close" i]',
            '[role="button"][aria-label*="Close" i]',
            'button[title*="Close" i]',
            '[role="button"][title*="Close" i]',
            'button:has-text("Close")',
        ]);

    if (!closeButton) {
        return;
    }

    try {
        await closeButton.click({
            timeout: 5_000,
        });

        await page.waitForTimeout(300);
    } catch {
        // Not fatal.
    }
}

// -----------------------------------------------------------------------------
// Process person
// -----------------------------------------------------------------------------

async function processPerson(
    page: Page,
    person: Person,
): Promise<PersonRecord> {
    console.log('\n----------------------------------------');
    console.log(`PROCESSING: ${person.name}`);
    console.log(`IMDb ID: ${person.imdbId}`);
    console.log(`Profile: ${person.profileUrl}`);
    console.log(
        `Discovery page: ${person.discoveryPage}`,
    );
    console.log('----------------------------------------');

    try {
        let loaded = false;

        for (
            let attempt = 1;
            attempt <= 2;
            attempt++
        ) {
            try {
                await page.goto(
                    person.profileUrl,
                    {
                        waitUntil: 'domcontentloaded',
                        timeout: 120_000,
                    },
                );

                await page.waitForTimeout(
                    2_000,
                );

                loaded = true;

                break;
            } catch (error) {
                console.warn(
                    `Profile load attempt ${attempt} failed: ${getErrorMessage(error)}`,
                );

                if (attempt === 2) {
                    throw error;
                }

                await page.waitForTimeout(
                    2_000,
                );
            }
        }

        if (!loaded) {
            throw new Error(
                'Profile could not be loaded.',
            );
        }

        console.log(
            `Profile loaded: ${page.url()}`,
        );

        const contact =
            await getDirectContact(page);

        console.log(
            `Contact status: ${contact.status}`,
        );

        if (contact.email) {
            console.log(
                `EMAIL: ${contact.email}`,
            );
        }

        if (contact.url) {
            console.log(
                `CONTACT URL: ${contact.url}`,
            );
        }

        return {
            imdbId: person.imdbId,
            name: person.name,
            profileUrl: person.profileUrl,
            discoveryPage:
                person.discoveryPage,
            contactEmail:
                contact.email,
            contactUrl:
                contact.url,
            directContactRaw:
                contact.raw,
            contactStatus:
                contact.status,
            error:
                contact.error,
        };
    } catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            `ERROR PROCESSING ${person.name}: ${message}`,
        );

        return {
            imdbId: person.imdbId,
            name: person.name,
            profileUrl: person.profileUrl,
            discoveryPage:
                person.discoveryPage,
            contactEmail: null,
            contactUrl: null,
            directContactRaw: null,
            contactStatus: 'error',
            error: message,
        };
    } finally {
        await closeDirectContactIfOpen(page);
    }
}

// -----------------------------------------------------------------------------
// Save progress
// -----------------------------------------------------------------------------

async function saveProgress(
    progress: Progress,
): Promise<void> {
    await Actor.setValue(
        PROGRESS_KEY,
        progress,
    );
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

await Actor.init();

const input =
    (await Actor.getInput()) as Input | null;

if (
    !input?.startUrl
    || !input.startUrl.trim()
) {
    throw new Error(
        'startUrl is required. Paste the exact IMDbPro discovery URL you want to scrape.',
    );
}

const startUrl =
    input.startUrl.trim();

let parsedStartUrl: URL;

try {
    parsedStartUrl =
        new URL(startUrl);
} catch {
    throw new Error(
        'The provided startUrl is not a valid URL.',
    );
}

const maxPages =
    Math.max(
        0,
        input.maxPages ?? 0,
    );

const maxDirectors =
    Math.max(
        0,
        input.maxDirectors ?? 0,
    );

// IMPORTANT:
// The page number comes directly from the URL supplied by the user.

const startPage =
    getPageNumberFromUrl(
        parsedStartUrl.toString(),
    );

console.log('\n==============================');
console.log('IMDbPro CONTACT SCRAPER');
console.log('==============================');

console.log(
    'REQUESTED START URL:',
);
console.log(startUrl);

console.log(
    `START PAGE READ FROM URL: ${startPage}`,
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
        maxDirectors === 0
            ? 'UNLIMITED'
            : maxDirectors
    }`,
);

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

if (
    !fs.existsSync(STORAGE_FILE)
) {
    throw new Error(
        `Authentication file not found: ${STORAGE_FILE}`,
    );
}

console.log(
    'Loading saved IMDbPro authentication...',
);

const browser: Browser =
    await chromium.launch({
        headless: true,
    });

const context: BrowserContext =
    await browser.newContext({
        storageState: STORAGE_FILE,

        viewport: {
            width: 1920,
            height: 1080,
        },
    });

await context.grantPermissions(
    [
        'clipboard-read',
        'clipboard-write',
    ],
    {
        origin: 'https://pro.imdb.com',
    },
);

const discoveryPage =
    await context.newPage();

const profilePage =
    await context.newPage();

// -----------------------------------------------------------------------------
// Counters
// -----------------------------------------------------------------------------

const seenImdbIds =
    new Set<string>();

let totalPeopleFound = 0;
let totalPeopleProcessed = 0;
let totalPeopleWithContact = 0;

let lastCompletedPage =
    startPage - 1;

let pageNumber =
    startPage;

let pagesProcessed = 0;

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

while (true) {
    if (
        maxPages > 0
        && pagesProcessed >= maxPages
    ) {
        console.log(
            `Reached configured page limit: ${maxPages}`,
        );

        break;
    }

    if (
        maxDirectors > 0
        && totalPeopleProcessed >= maxDirectors
    ) {
        console.log(
            `Reached configured profile limit: ${maxDirectors}`,
        );

        break;
    }

    console.log('\n==============================');
    console.log(
        `OPENING DISCOVERY PAGE ${pageNumber}`,
    );
    console.log('==============================');

    // -------------------------------------------------------------------------
    // CRITICAL URL LOGIC
    //
    // On the first iteration, use the exact URL supplied by the user.
    //
    // We do NOT reconstruct it.
    // We do NOT change pageNumber.
    //
    // On later pages, only pageNumber changes.
    // Every other URL parameter remains exactly preserved.
    // -------------------------------------------------------------------------

    const discoveryUrl =
        pagesProcessed === 0
            ? startUrl
            : getUrlForPage(
                startUrl,
                pageNumber,
            );

    console.log(
        'DISCOVERY URL BEING OPENED:',
    );
    console.log(discoveryUrl);

    // -------------------------------------------------------------------------
    // Load discovery page.
    // -------------------------------------------------------------------------

    let discoveryLoaded = false;

    for (
        let attempt = 1;
        attempt <= 2;
        attempt++
    ) {
        try {
            await discoveryPage.goto(
                discoveryUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 120_000,
                },
            );

            console.log(
                'Waiting for results to load...',
            );

            await discoveryPage.waitForTimeout(
                5_000,
            );

            discoveryLoaded = true;

            break;
        } catch (error) {
            console.error(
                `Discovery page ${pageNumber} attempt ${attempt} failed: ${getErrorMessage(error)}`,
            );

            if (attempt < 2) {
                await discoveryPage.waitForTimeout(
                    2_000,
                );
            }
        }
    }

    if (!discoveryLoaded) {
        console.error(
            `Could not load discovery page ${pageNumber}. Stopping.`,
        );

        break;
    }

    // -------------------------------------------------------------------------
    // Verification.
    // -------------------------------------------------------------------------

    console.log(
        '\nACTUAL DISCOVERY URL AFTER PAGE LOAD:',
    );

    console.log(
        discoveryPage.url(),
    );

    console.log(
        'DISCOVERY PAGE TITLE:',
    );

    console.log(
        await discoveryPage.title(),
    );

    // -------------------------------------------------------------------------
    // Find people.
    // -------------------------------------------------------------------------

    const nameLinks =
        discoveryPage.locator(
            'a[href*="/name/nm"]',
        );

    const count =
        await nameLinks.count();

    console.log(
        `NAME LINKS FOUND ON PAGE ${pageNumber}: ${count}`,
    );

    if (count === 0) {
        console.log(
            `No people found on page ${pageNumber}.`,
        );

        console.log(
            'Stopping pagination.',
        );

        break;
    }

    // -------------------------------------------------------------------------
    // Collect unique people.
    // -------------------------------------------------------------------------

    const peopleOnPage: Person[] =
        [];

    for (
        let i = 0;
        i < count;
        i++
    ) {
        if (
            maxDirectors > 0
            && (
                totalPeopleProcessed
                + peopleOnPage.length
            ) >= maxDirectors
        ) {
            break;
        }

        const link =
            nameLinks.nth(i);

        const name =
            normalizeText(
                await link
                    .innerText()
                    .catch(() => ''),
            );

        const href =
            await link
                .getAttribute('href')
                .catch(() => null);

        if (!href) {
            continue;
        }

        const imdbId =
            extractImdbId(href);

        if (!imdbId) {
            continue;
        }

        const profileUrl =
            new URL(
                href,
                discoveryPage.url(),
            ).toString();

        totalPeopleFound++;

        if (
            seenImdbIds.has(imdbId)
        ) {
            console.log(
                `DUPLICATE SKIPPED: ${name} (${imdbId})`,
            );

            continue;
        }

        seenImdbIds.add(imdbId);

        peopleOnPage.push({
            imdbId,
            name,
            profileUrl,
            discoveryPage:
                pageNumber,
        });
    }

    console.log(
        `UNIQUE PEOPLE ON PAGE ${pageNumber}: ${peopleOnPage.length}`,
    );

    // -------------------------------------------------------------------------
    // Verification: print names before processing.
    //
    // Compare these names directly with what you see in IMDbPro.
    // -------------------------------------------------------------------------

    console.log(
        '\nFIRST PEOPLE FOUND ON THIS DISCOVERY PAGE:',
    );

    const verificationCount =
        Math.min(
            10,
            peopleOnPage.length,
        );

    for (
        let i = 0;
        i < verificationCount;
        i++
    ) {
        const person =
            peopleOnPage[i];

        console.log(
            `${i + 1}. ${person.name} (${person.imdbId})`,
        );
    }

    console.log(
        '----------------------------------------',
    );

    // -------------------------------------------------------------------------
    // Process each person.
    // -------------------------------------------------------------------------

    for (
        const person of peopleOnPage
    ) {
        if (
            maxDirectors > 0
            && totalPeopleProcessed >= maxDirectors
        ) {
            break;
        }

        const result =
            await processPerson(
                profilePage,
                person,
            );

        totalPeopleProcessed++;

        if (
            result.contactStatus === 'found'
            && (
                result.contactEmail
                || result.contactUrl
                || result.directContactRaw
            )
        ) {
            totalPeopleWithContact++;
        }

        // ---------------------------------------------------------------------
        // Save successful contact immediately.
        // ---------------------------------------------------------------------

        if (
            result.contactStatus === 'found'
        ) {
            const directContact =
                result.directContactRaw
                || result.contactEmail
                || result.contactUrl;

            if (directContact) {
                await Actor.pushData({
                    name:
                        result.name,
                    imdbId:
                        result.imdbId,
                    profileUrl:
                        result.profileUrl,
                    discoveryPage:
                        result.discoveryPage,
                    directContact,
                    contactEmail:
                        result.contactEmail,
                    contactUrl:
                        result.contactUrl,
                });
            }
        }

        console.log(
            `Processed: ${totalPeopleProcessed}`,
        );

        console.log(
            `Contacts found so far: ${totalPeopleWithContact}`,
        );
    }

    // -------------------------------------------------------------------------
    // Save progress.
    // -------------------------------------------------------------------------

    lastCompletedPage =
        pageNumber;

    pagesProcessed++;

    await saveProgress({
        lastCompletedPage,
        totalPeopleDiscovered:
            totalPeopleFound,
        totalPeopleProcessed,
        totalPeopleWithContact,
        updatedAt:
            new Date().toISOString(),
    });

    console.log('\n----------------------------------------');
    console.log(
        `COMPLETED DISCOVERY PAGE ${pageNumber}`,
    );

    console.log(
        `Last completed page: ${lastCompletedPage}`,
    );

    console.log(
        `Total unique people: ${seenImdbIds.size}`,
    );

    console.log(
        `Total processed: ${totalPeopleProcessed}`,
    );

    console.log(
        `Total contacts found: ${totalPeopleWithContact}`,
    );

    console.log('----------------------------------------');

    // Next page.
    pageNumber++;
}

// -----------------------------------------------------------------------------
// Final summary
// -----------------------------------------------------------------------------

console.log('\n==============================');
console.log('SCRAPING STOPPED / FINISHED');
console.log('==============================');

console.log(
    `Last completed discovery page: ${lastCompletedPage}`,
);

console.log(
    `People discovered: ${totalPeopleFound}`,
);

console.log(
    `Unique people: ${seenImdbIds.size}`,
);

console.log(
    `People processed: ${totalPeopleProcessed}`,
);

console.log(
    `People with contact data: ${totalPeopleWithContact}`,
);

console.log(
    `People without contact: ${
        totalPeopleProcessed
        - totalPeopleWithContact
    }`,
);

console.log('==============================');

await profilePage.close();
await discoveryPage.close();

await browser.close();

await Actor.exit();
