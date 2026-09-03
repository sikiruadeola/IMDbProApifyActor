import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
    type StorageState,
} from 'playwright';

// ============================================================================
// TYPES
// ============================================================================

interface Input {
    startUrl: string;

    /**
     * Paste the complete contents of the Playwright storage-state JSON here.
     *
     * Accepted formats:
     * - JSON object
     * - JSON string containing the storage-state object
     */
    authState: unknown;

    /**
     * 0 = unlimited
     */
    maxPages?: number;

    /**
     * 0 = unlimited
     */
    maxProfiles?: number;
}

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
}

interface ContactResult {
    status: 'found' | 'not_found' | 'error';
    email: string | null;
    url: string | null;
    raw: string | null;
    error: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PROFILE_WAIT_MS = 3000;
const DISCOVERY_WAIT_MS = 5000;
const CONTACT_WAIT_MS = 2500;

const PAGE_TIMEOUT_MS = 120000;

// ============================================================================
// GENERAL HELPERS
// ============================================================================

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractImdbId(href: string): string | null {
    const match = href.match(/\/name\/(nm\d+)/i);

    return match ? match[1] : null;
}

function extractEmail(text: string): string | null {
    const match = text.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match ? match[0] : null;
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

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

function getPageNumberFromUrl(urlString: string): number {
    const url = new URL(urlString);

    const value = Number(
        url.searchParams.get('pageNumber') ?? '1',
    );

    if (!Number.isFinite(value) || value < 1) {
        return 1;
    }

    return Math.floor(value);
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

// ============================================================================
// AUTH STATE PARSING
//
// IMPORTANT:
//
// browser.newContext({ storageState })
//
// requires Playwright's StorageState type.
//
// The previous version returned the generic TypeScript type "object",
// which caused:
//
// TS2322: Type 'object' is not assignable to type StorageState
// ============================================================================

function parseStorageState(
    value: unknown,
): StorageState {
    if (!value) {
        throw new Error(
            'authState is required. Paste the complete contents of imdb-auth-state.json into the Actor input.',
        );
    }

    let parsed: unknown;

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) {
            throw new Error(
                'authState is empty.',
            );
        }

        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(
                `Could not parse authState JSON: ${getErrorMessage(error)}`,
            );
        }
    } else {
        parsed = value;
    }

    if (
        !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
    ) {
        throw new Error(
            'authState must be a valid Playwright storage-state JSON object.',
        );
    }

    const candidate =
        parsed as Partial<StorageState>;

    if (!Array.isArray(candidate.cookies)) {
        throw new Error(
            'authState is invalid. Expected a "cookies" array.',
        );
    }

    return {
        cookies: candidate.cookies,
        origins: Array.isArray(candidate.origins)
            ? candidate.origins
            : [],
    };
}

// ============================================================================
// LOCATOR HELPERS
// ============================================================================

async function isVisible(
    locator: Locator,
): Promise<boolean> {
    try {
        return await locator.isVisible();
    } catch {
        return false;
    }
}

async function safeClick(
    locator: Locator,
): Promise<boolean> {
    try {
        await locator
            .scrollIntoViewIfNeeded()
            .catch(() => {});

        await locator.click({
            timeout: 10000,
        });

        return true;
    } catch {
        try {
            await locator.click({
                timeout: 10000,
                force: true,
            });

            return true;
        } catch {
            return false;
        }
    }
}

async function getFirstVisibleLocator(
    page: Page,
    selectors: string[],
): Promise<Locator | null> {
    for (const selector of selectors) {
        const locator =
            page.locator(selector);

        const count =
            await locator
                .count()
                .catch(() => 0);

        for (
            let i = 0;
            i < count;
            i++
        ) {
            const candidate =
                locator.nth(i);

            if (
                await isVisible(candidate)
            ) {
                return candidate;
            }
        }
    }

    return null;
}

// ============================================================================
// PROFILE NAME EXTRACTION
// ============================================================================

async function getCleanProfileName(
    page: Page,
    fallbackName: string,
): Promise<string> {
    const selectors = [
        'h1',
        '[data-testid*="name-header" i] h1',
        '[data-testid*="name" i] h1',
    ];

    for (const selector of selectors) {
        const locator =
            page.locator(selector);

        const count =
            await locator
                .count()
                .catch(() => 0);

        for (
            let i = 0;
            i < count;
            i++
        ) {
            const text =
                normalizeText(
                    await locator
                        .nth(i)
                        .innerText()
                        .catch(() => ''),
                );

            if (
                text.length > 0
                && text.length < 200
            ) {
                return text;
            }
        }
    }

    return fallbackName;
}

// ============================================================================
// CONTACT BUTTON DETECTION
//
// The Actor opens the individual profile first.
//
// It does NOT attempt to extract contact information directly from the
// discovery results page.
// ============================================================================

async function findContactButton(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',

        'button:has-text("Contact")',
        '[role="button"]:has-text("Contact")',
        'a:has-text("Contact")',

        '[aria-label*="Direct Contact" i]',
        '[title*="Direct Contact" i]',

        '[aria-label*="Contact" i]',
        '[title*="Contact" i]',
    ];

    const direct =
        await getFirstVisibleLocator(
            page,
            selectors,
        );

    if (direct) {
        return direct;
    }

    const textCandidates =
        page.getByText(
            /Direct Contact|Contact/i,
        );

    const count =
        await textCandidates
            .count()
            .catch(() => 0);

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const candidate =
            textCandidates.nth(i);

        if (
            !await isVisible(candidate)
        ) {
            continue;
        }

        const clickable =
            candidate.locator(
                'xpath=ancestor-or-self::button | ancestor-or-self::a | ancestor-or-self::*[@role="button"]',
            ).first();

        const clickableCount =
            await clickable
                .count()
                .catch(() => 0);

        if (
            clickableCount > 0
            && await isVisible(clickable)
        ) {
            return clickable;
        }

        return candidate;
    }

    return null;
}

// ============================================================================
// CONTACT CONTAINER
// ============================================================================

async function findContactContainer(
    page: Page,
): Promise<Locator> {
    const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[data-testid*="contact" i]',
        '[class*="contact" i]',
    ];

    const found =
        await getFirstVisibleLocator(
            page,
            selectors,
        );

    if (found) {
        return found;
    }

    return page.locator('body');
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================

async function getLinks(
    root: Locator,
): Promise<string[]> {
    const links =
        root.locator('a[href]');

    const count =
        await links
            .count()
            .catch(() => 0);

    const result: string[] = [];

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const href =
            await links
                .nth(i)
                .getAttribute('href')
                .catch(() => null);

        if (!href) {
            continue;
        }

        if (
            href.startsWith('http://')
            || href.startsWith('https://')
        ) {
            result.push(href);
        }
    }

    return [
        ...new Set(result),
    ];
}

// ============================================================================
// DIRECT CONTACT EXTRACTION
// ============================================================================

async function getDirectContact(
    page: Page,
): Promise<ContactResult> {
    try {
        console.log(
            'Searching profile for contact control...',
        );

        let button =
            await findContactButton(page);

        // IMDbPro may render the control after the main page loads.
        if (!button) {
            await page.waitForTimeout(2000);

            button =
                await findContactButton(page);
        }

        // Scroll through the profile and retry.
        if (!button) {
            console.log(
                'Contact control not immediately visible. Scrolling profile...',
            );

            for (
                let i = 0;
                i < 6;
                i++
            ) {
                await page.mouse.wheel(
                    0,
                    900,
                );

                await page.waitForTimeout(
                    700,
                );

                button =
                    await findContactButton(page);

                if (button) {
                    break;
                }
            }
        }

        if (!button) {
            console.log(
                'Contact control not found on this profile.',
            );

            return {
                status: 'not_found',
                email: null,
                url: null,
                raw: null,
                error: null,
            };
        }

        console.log(
            'Contact control found. Clicking...',
        );

        const clicked =
            await safeClick(button);

        if (!clicked) {
            return {
                status: 'error',
                email: null,
                url: null,
                raw: null,
                error: 'Contact control was found but could not be clicked.',
            };
        }

        await page.waitForTimeout(
            CONTACT_WAIT_MS,
        );

        const root =
            await findContactContainer(
                page,
            );

        const visibleText =
            normalizeText(
                await root
                    .innerText()
                    .catch(() => ''),
            );

        const links =
            await getLinks(root);

        const combined =
            [
                visibleText,
                links.join('\n'),
            ]
                .filter(Boolean)
                .join('\n');

        console.log(
            `Contact text length: ${visibleText.length}`,
        );

        console.log(
            `Contact links found: ${links.length}`,
        );

        const email =
            extractEmail(combined);

        let contactUrl =
            extractUrl(combined);

        if (
            !contactUrl
            && links.length > 0
        ) {
            contactUrl = links[0];
        }

        if (
            visibleText
            || email
            || contactUrl
        ) {
            return {
                status: 'found',
                email,
                url: contactUrl,
                raw: combined || null,
                error: null,
            };
        }

        return {
            status: 'not_found',
            email: null,
            url: null,
            raw: null,
            error: null,
        };
    } catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            `Contact extraction error: ${message}`,
        );

        return {
            status: 'error',
            email: null,
            url: null,
            raw: null,
            error: message,
        };
    }
}

// ============================================================================
// PROCESS ONE PROFILE
// ============================================================================

async function processPerson(
    page: Page,
    person: Person,
): Promise<ContactResult> {
    console.log('');
    console.log(
        '----------------------------------------',
    );
    console.log(
        `PROCESSING IMDb ID: ${person.imdbId}`,
    );
    console.log(
        `PROFILE: ${person.profileUrl}`,
    );
    console.log(
        '----------------------------------------',
    );

    try {
        await page.goto(
            person.profileUrl,
            {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT_MS,
            },
        );

        await page.waitForTimeout(
            PROFILE_WAIT_MS,
        );

        console.log(
            `PROFILE LOADED: ${page.url()}`,
        );

        const cleanName =
            await getCleanProfileName(
                page,
                person.name,
            );

        console.log(
            `PROFILE NAME: ${cleanName}`,
        );

        const contact =
            await getDirectContact(page);

        console.log(
            `CONTACT STATUS: ${contact.status}`,
        );

        if (
            contact.status === 'found'
            && (
                contact.email
                || contact.url
                || contact.raw
            )
        ) {
            await Actor.pushData({
                name: cleanName,
                imdbId: person.imdbId,
                profileUrl: person.profileUrl,
                discoveryPage:
                    person.discoveryPage,

                directContact:
                    contact.raw
                    ?? contact.email
                    ?? contact.url,

                contactEmail:
                    contact.email,

                contactUrl:
                    contact.url,
            });

            console.log(
                'CONTACT DATA SAVED.',
            );
        }

        return contact;
    } catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            `PROFILE ERROR: ${message}`,
        );

        return {
            status: 'error',
            email: null,
            url: null,
            raw: null,
            error: message,
        };
    }
}

// ============================================================================
// ACTOR START
// ============================================================================

await Actor.init();

let browser: Browser | null = null;

try {
    const input =
        await Actor.getInput<Input>();

    if (
        !input
        || !input.startUrl
        || !input.startUrl.trim()
    ) {
        throw new Error(
            'startUrl is required.',
        );
    }

    const startUrl =
        input.startUrl.trim();

    // Validate URL before starting.
    new URL(startUrl);

    const storageState =
        parseStorageState(
            input.authState,
        );

    const maxPages =
        Math.max(
            0,
            Number(
                input.maxPages ?? 0,
            ),
        );

    const maxProfiles =
        Math.max(
            0,
            Number(
                input.maxProfiles ?? 0,
            ),
        );

    const startPage =
        getPageNumberFromUrl(
            startUrl,
        );

    console.log('');
    console.log(
        '========================================',
    );
    console.log(
        'IMDbPro CONTACT SCRAPER',
    );
    console.log(
        '========================================',
    );

    console.log(
        `START URL: ${startUrl}`,
    );

    console.log(
        `START PAGE: ${startPage}`,
    );

    console.log(
        `MAX PAGES: ${
            maxPages === 0
                ? 'UNLIMITED'
                : maxPages
        }`,
    );

    console.log(
        `MAX PROFILES: ${
            maxProfiles === 0
                ? 'UNLIMITED'
                : maxProfiles
        }`,
    );

    // ========================================================================
    // BROWSER
    // ========================================================================

    browser =
        await chromium.launch({
            headless: true,
        });

    const context: BrowserContext =
        await browser.newContext({
            storageState,

            viewport: {
                width: 1920,
                height: 1080,
            },
        });

    const discoveryPage =
        await context.newPage();

    const profilePage =
        await context.newPage();

    // ========================================================================
    // AUTHENTICATION CHECK
    // ========================================================================

    console.log('');
    console.log(
        'Verifying IMDbPro authentication...',
    );

    await discoveryPage.goto(
        startUrl,
        {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT_MS,
        },
    );

    await discoveryPage.waitForTimeout(
        DISCOVERY_WAIT_MS,
    );

    console.log(
        `AUTH CHECK URL: ${discoveryPage.url()}`,
    );

    console.log(
        `AUTH CHECK TITLE: ${await discoveryPage.title()}`,
    );

    if (
        /login|signin|sign-in/i.test(
            discoveryPage.url(),
        )
    ) {
        throw new Error(
            'IMDbPro authentication appears to have failed. Generate a fresh imdb-auth-state.json and paste its complete contents into authState.',
        );
    }

    // ========================================================================
    // PAGINATION
    // ========================================================================

    const seenIds =
        new Set<string>();

    let pageNumber =
        startPage;

    let pagesProcessed = 0;

    let profilesProcessed = 0;

    let contactsFound = 0;

    while (true) {
        if (
            maxPages > 0
            && pagesProcessed >= maxPages
        ) {
            console.log(
                'Maximum page limit reached.',
            );

            break;
        }

        if (
            maxProfiles > 0
            && profilesProcessed >= maxProfiles
        ) {
            console.log(
                'Maximum profile limit reached.',
            );

            break;
        }

        const discoveryUrl =
            pageNumber === startPage
                ? startUrl
                : getUrlForPage(
                    startUrl,
                    pageNumber,
                );

        console.log('');
        console.log(
            '========================================',
        );

        console.log(
            `OPENING DISCOVERY PAGE ${pageNumber}`,
        );

        console.log(
            '========================================',
        );

        console.log(
            discoveryUrl,
        );

        await discoveryPage.goto(
            discoveryUrl,
            {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT_MS,
            },
        );

        await discoveryPage.waitForTimeout(
            DISCOVERY_WAIT_MS,
        );

        console.log(
            `ACTUAL URL: ${discoveryPage.url()}`,
        );

        // ====================================================================
        // FIND PROFILE LINKS
        // ====================================================================

        const links =
            discoveryPage.locator(
                'a[href*="/name/nm"]',
            );

        const linkCount =
            await links.count();

        console.log(
            `NAME LINKS FOUND: ${linkCount}`,
        );

        if (linkCount === 0) {
            console.log(
                'No profile links found. Stopping.',
            );

            break;
        }

        const people: Person[] = [];

        for (
            let i = 0;
            i < linkCount;
            i++
        ) {
            if (
                maxProfiles > 0
                && (
                    profilesProcessed
                    + people.length
                ) >= maxProfiles
            ) {
                break;
            }

            const link =
                links.nth(i);

            const href =
                await link
                    .getAttribute(
                        'href',
                    )
                    .catch(() => null);

            if (!href) {
                continue;
            }

            const imdbId =
                extractImdbId(
                    href,
                );

            if (!imdbId) {
                continue;
            }

            if (
                seenIds.has(imdbId)
            ) {
                continue;
            }

            seenIds.add(
                imdbId,
            );

            const fallbackName =
                normalizeText(
                    await link
                        .innerText()
                        .catch(() => ''),
                );

            const profileUrl =
                new URL(
                    href,
                    discoveryPage.url(),
                ).toString();

            people.push({
                imdbId,

                name:
                    fallbackName
                    || imdbId,

                profileUrl,

                discoveryPage:
                    pageNumber,
            });
        }

        console.log(
            `UNIQUE PROFILES ON PAGE: ${people.length}`,
        );

        if (
            people.length === 0
        ) {
            console.log(
                'No new profiles found. Stopping.',
            );

            break;
        }

        // ====================================================================
        // PROCESS PROFILES
        // ====================================================================

        for (
            const person of people
        ) {
            if (
                maxProfiles > 0
                && profilesProcessed
                    >= maxProfiles
            ) {
                break;
            }

            const result =
                await processPerson(
                    profilePage,
                    person,
                );

            profilesProcessed++;

            if (
                result.status === 'found'
                && (
                    result.email
                    || result.url
                    || result.raw
                )
            ) {
                contactsFound++;
            }

            console.log(
                `TOTAL PROFILES PROCESSED: ${profilesProcessed}`,
            );

            console.log(
                `CONTACTS CONFIRMED SO FAR: ${contactsFound}`,
            );
        }

        pagesProcessed++;

        console.log('');

        console.log(
            `COMPLETED DISCOVERY PAGE ${pageNumber}`,
        );

        console.log(
            `TOTAL UNIQUE IMDb IDs: ${seenIds.size}`,
        );

        console.log(
            `TOTAL PROFILES PROCESSED: ${profilesProcessed}`,
        );

        console.log(
            `TOTAL CONTACTS FOUND: ${contactsFound}`,
        );

        pageNumber++;
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    await profilePage
        .close()
        .catch(() => {});

    await discoveryPage
        .close()
        .catch(() => {});

    await context
        .close()
        .catch(() => {});

    console.log('');

    console.log(
        '========================================',
    );

    console.log(
        'SCRAPING FINISHED',
    );

    console.log(
        '========================================',
    );

    console.log(
        `PAGES PROCESSED: ${pagesProcessed}`,
    );

    console.log(
        `UNIQUE PROFILES: ${seenIds.size}`,
    );

    console.log(
        `PROFILES PROCESSED: ${profilesProcessed}`,
    );

    console.log(
        `CONTACTS FOUND: ${contactsFound}`,
    );
} catch (error) {
    console.error('');

    console.error(
        '========================================',
    );

    console.error(
        'ACTOR FAILED',
    );

    console.error(
        '========================================',
    );

    console.error(
        getErrorMessage(error),
    );

    throw error;
} finally {
    if (browser) {
        await browser
            .close()
            .catch(() => {});
    }

    await Actor.exit();
}
