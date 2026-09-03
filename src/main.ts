import { Actor } from 'apify';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
    type Locator,
} from 'playwright';

interface Input {
    startUrl: string;
    authState: string;
    maxPages?: number;
    maxProfiles?: number;
}

interface Person {
    imdbId: string;
    name: string;
    profileUrl: string;
    discoveryPage: number;
}

interface ContactResult {
    email: string | null;
}

// Only accept actual email addresses from the clipboard.
const EMAIL_REGEX =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizeText(
    value: string | null | undefined,
): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * IMDbPro URLs copied from HTML sometimes contain &amp;.
 * Convert it back to a real ampersand before navigation.
 */
function normalizeUrl(
    value: string,
): string {
    return value
        .replace(/&amp;/gi, '&')
        .trim();
}

function extractImdbId(
    href: string,
): string | null {
    const match =
        href.match(/\/name\/(nm\d+)/i);

    return match
        ? match[1]
        : null;
}

function extractEmail(
    text: string,
): string | null {
    const match =
        text.match(EMAIL_REGEX);

    return match
        ? match[0].trim()
        : null;
}

async function isVisible(
    locator: Locator,
): Promise<boolean> {
    return locator
        .isVisible()
        .catch(() => false);
}

async function findVisibleLocator(
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

// -----------------------------------------------------------------------------
// Direct Contact controls
// -----------------------------------------------------------------------------

async function findDirectContactControl(
    page: Page,
): Promise<Locator | null> {
    console.log(
        'SEARCHING FOR DIRECT CONTACT CONTROL...',
    );

    const selectors = [
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',
        '[aria-label*="Direct Contact" i]',
        '[title*="Direct Contact" i]',
        'text=Direct Contact',
    ];

    const control =
        await findVisibleLocator(
            page,
            selectors,
        );

    if (control) {
        console.log(
            'DIRECT CONTACT CONTROL FOUND.',
        );
    }

    return control;
}

/**
 * Generic Contact is only used as a fallback to expose
 * the Direct Contact section.
 *
 * We explicitly reject anything that itself says
 * "Direct Contact", because Direct Contact must be
 * handled separately.
 */
async function findContactTab(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        'button:has-text("Contact")',
        '[role="button"]:has-text("Contact")',
        'a:has-text("Contact")',
        '[aria-label*="Contact" i]',
        '[title*="Contact" i]',
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
            const candidate =
                locator.nth(i);

            if (
                !(await isVisible(candidate))
            ) {
                continue;
            }

            const text =
                normalizeText(
                    await candidate
                        .innerText()
                        .catch(() => ''),
                );

            const aria =
                normalizeText(
                    await candidate
                        .getAttribute('aria-label')
                        .catch(() => ''),
                );

            const title =
                normalizeText(
                    await candidate
                        .getAttribute('title')
                        .catch(() => ''),
                );

            const combined =
                `${text} ${aria} ${title}`;

            if (
                /direct\s+contact/i.test(
                    combined,
                )
            ) {
                continue;
            }

            if (
                /\bcontact\b/i.test(
                    combined,
                )
            ) {
                return candidate;
            }
        }
    }

    return null;
}

async function findDirectContactText(
    page: Page,
): Promise<Locator | null> {
    const selectors = [
        'text=Direct Contact',
        '[aria-label*="Direct Contact" i]',
        '[title*="Direct Contact" i]',
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',
    ];

    return findVisibleLocator(
        page,
        selectors,
    );
}

// -----------------------------------------------------------------------------
// Copy button
// -----------------------------------------------------------------------------

/**
 * Find a Copy button ONLY inside the supplied container.
 *
 * This is deliberately NOT page-wide.
 */
async function findCopyButtonInContainer(
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
        'button:has(svg[data-icon="copy"])',
        'button:has(svg[aria-label*="copy" i])',
        'button:has(svg[title*="copy" i])',
    ];

    for (const selector of selectors) {
        const locator =
            container.locator(selector);

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

/**
 * Walk upward from Direct Contact until we find
 * a container that actually contains its Copy button.
 */
async function findDirectContactContainer(
    page: Page,
    directContactControl: Locator,
): Promise<Locator | null> {
    let current =
        directContactControl;

    for (
        let level = 0;
        level < 8;
        level++
    ) {
        const copyButton =
            await findCopyButtonInContainer(
                current,
            );

        if (copyButton) {
            console.log(
                `DIRECT CONTACT CONTAINER FOUND AT LEVEL ${level}.`,
            );

            return current;
        }

        const parent =
            current.locator('..');

        const parentCount =
            await parent
                .count()
                .catch(() => 0);

        if (parentCount === 0) {
            break;
        }

        current = parent;
    }

    console.log(
        'DIRECT CONTACT CONTAINER COULD NOT BE IDENTIFIED.',
    );

    return null;
}

// -----------------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------------

async function clearClipboard(
    page: Page,
): Promise<void> {
    try {
        await page.evaluate(
            async () => {
                try {
                    await navigator.clipboard
                        .writeText('');
                } catch {
                    // Ignore clipboard errors.
                }
            },
        );
    } catch {
        // Ignore.
    }
}

async function readClipboard(
    page: Page,
): Promise<string> {
    try {
        const value =
            await page.evaluate(
                async () => {
                    try {
                        return await navigator
                            .clipboard
                            .readText();
                    } catch {
                        return '';
                    }
                },
            );

        return normalizeText(value);
    } catch {
        return '';
    }
}

// -----------------------------------------------------------------------------
// Extract ONLY Direct Contact email
// -----------------------------------------------------------------------------

async function extractDirectContactEmail(
    page: Page,
): Promise<ContactResult> {
    try {
        // ---------------------------------------------------------------------
        // 1. Find Direct Contact directly.
        // ---------------------------------------------------------------------

        let directContactControl =
            await findDirectContactControl(
                page,
            );

        // ---------------------------------------------------------------------
        // 2. If Direct Contact is not visible, open generic Contact.
        // ---------------------------------------------------------------------

        if (!directContactControl) {
            console.log(
                'DIRECT CONTACT CONTROL NOT FOUND DIRECTLY.',
            );

            const contactTab =
                await findContactTab(page);

            if (contactTab) {
                console.log(
                    'CONTACT CONTROL FOUND. CLICKING...',
                );

                await contactTab
                    .click({
                        timeout: 15_000,
                    })
                    .catch(() => {});

                await page.waitForTimeout(
                    1_500,
                );

                directContactControl =
                    await findDirectContactControl(
                        page,
                    );
            }
        }

        // ---------------------------------------------------------------------
        // 3. Give IMDbPro another moment to render Direct Contact.
        // ---------------------------------------------------------------------

        if (!directContactControl) {
            await page.waitForTimeout(
                1_500,
            );

            directContactControl =
                await findDirectContactText(
                    page,
                );
        }

        if (!directContactControl) {
            console.log(
                'NO DIRECT CONTACT SECTION.',
            );

            return {
                email: null,
            };
        }

        console.log(
            'DIRECT CONTACT FOUND.',
        );

        // ---------------------------------------------------------------------
        // 4. Open Direct Contact if it is an interactive control.
        // ---------------------------------------------------------------------

        const tagName =
            await directContactControl
                .evaluate(
                    (element) =>
                        element.tagName
                            .toLowerCase(),
                )
                .catch(() => '');

        if (
            tagName === 'button'
            || tagName === 'a'
            || tagName === 'summary'
        ) {
            await directContactControl
                .click({
                    timeout: 15_000,
                })
                .catch(() => {});

            await page.waitForTimeout(
                1_500,
            );
        }

        // ---------------------------------------------------------------------
        // 5. Identify the Direct Contact container.
        // ---------------------------------------------------------------------

        const container =
            await findDirectContactContainer(
                page,
                directContactControl,
            );

        if (!container) {
            console.log(
                'NO SAFE DIRECT CONTACT CONTAINER.',
            );

            return {
                email: null,
            };
        }

        // ---------------------------------------------------------------------
        // 6. Clear clipboard BEFORE copying.
        //
        // This prevents an old clipboard value from being
        // accidentally interpreted as the current email.
        // ---------------------------------------------------------------------

        await clearClipboard(page);

        // ---------------------------------------------------------------------
        // 7. Find Copy button ONLY inside Direct Contact.
        // ---------------------------------------------------------------------

        let copyButton =
            await findCopyButtonInContainer(
                container,
            );

        if (!copyButton) {
            console.log(
                'DIRECT CONTACT COPY BUTTON NOT FOUND. WAITING...',
            );

            await page.waitForTimeout(
                2_000,
            );

            copyButton =
                await findCopyButtonInContainer(
                    container,
                );
        }

        // IMPORTANT:
        // There is intentionally NO page-wide fallback here.
        //
        // If we cannot prove that the Copy button belongs
        // to Direct Contact, we do not click anything.

        if (!copyButton) {
            console.log(
                'NO SAFE DIRECT CONTACT COPY BUTTON.',
            );

            return {
                email: null,
            };
        }

        console.log(
            'DIRECT CONTACT COPY BUTTON FOUND.',
        );

        // ---------------------------------------------------------------------
        // 8. Click the Direct Contact Copy button.
        // ---------------------------------------------------------------------

        console.log(
            'CLICKING DIRECT CONTACT COPY BUTTON...',
        );

        try {
            await copyButton.click({
                timeout: 10_000,
            });
        } catch (error) {
            console.error(
                `DIRECT CONTACT COPY ERROR: ${errorMessage(error)}`,
            );

            return {
                email: null,
            };
        }

        await page.waitForTimeout(
            500,
        );

        // ---------------------------------------------------------------------
        // 9. Read clipboard.
        // ---------------------------------------------------------------------

        const clipboardText =
            await readClipboard(page);

        if (!clipboardText) {
            console.log(
                'DIRECT CONTACT CLIPBOARD EMPTY.',
            );

            return {
                email: null,
            };
        }

        console.log(
            'DIRECT CONTACT CLIPBOARD RECEIVED.',
        );

        // ---------------------------------------------------------------------
        // 10. Extract email ONLY from copied Direct Contact data.
        // ---------------------------------------------------------------------

        const email =
            extractEmail(
                clipboardText,
            );

        if (!email) {
            console.log(
                'NO EMAIL FOUND IN DIRECT CONTACT CLIPBOARD.',
            );

            return {
                email: null,
            };
        }

        console.log(
            `DIRECT CONTACT EMAIL CONFIRMED: ${email}`,
        );

        return {
            email,
        };
    } catch (error) {
        console.error(
            `DIRECT CONTACT ERROR: ${errorMessage(error)}`,
        );

        return {
            email: null,
        };
    }
}

// -----------------------------------------------------------------------------
// Process one profile
// -----------------------------------------------------------------------------

async function processProfile(
    page: Page,
    person: Person,
): Promise<boolean> {
    console.log('');
    console.log(
        '========================================',
    );
    console.log(
        `PROCESSING: ${person.imdbId}`,
    );
    console.log(
        `PROFILE: ${person.profileUrl}`,
    );
    console.log(
        '========================================',
    );

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
                        waitUntil:
                            'domcontentloaded',
                        timeout: 120_000,
                    },
                );

                await page.waitForTimeout(
                    2_500,
                );

                loaded = true;
                break;
            } catch (error) {
                console.warn(
                    `PROFILE LOAD ATTEMPT ${attempt} FAILED: ${errorMessage(error)}`,
                );

                if (
                    attempt < 2
                ) {
                    await page.waitForTimeout(
                        2_000,
                    );
                }
            }
        }

        if (!loaded) {
            console.log(
                'PROFILE COULD NOT BE LOADED.',
            );

            return false;
        }

        console.log(
            `PROFILE ACTUAL URL: ${page.url()}`,
        );

        const contact =
            await extractDirectContactEmail(
                page,
            );

        // ---------------------------------------------------------------------
        // NEVER save a row without a confirmed Direct Contact email.
        // ---------------------------------------------------------------------

        if (!contact.email) {
            console.log(
                'NOT SAVED.',
            );

            return false;
        }

        // ---------------------------------------------------------------------
        // SAVE IMMEDIATELY.
        //
        // This happens before the scraper moves to the next profile.
        // ---------------------------------------------------------------------

        await Actor.pushData({
            imdbId: person.imdbId,
            name: person.name,
            profileUrl: person.profileUrl,
            discoveryPage:
                person.discoveryPage,
            contactEmail:
                contact.email,
        });

        console.log('');
        console.log(
            '****************************************',
        );
        console.log(
            'DIRECT CONTACT SAVED IMMEDIATELY',
        );
        console.log(
            `IMDb ID: ${person.imdbId}`,
        );
        console.log(
            `NAME: ${person.name}`,
        );
        console.log(
            `EMAIL: ${contact.email}`,
        );
        console.log(
            '****************************************',
        );

        return true;
    } catch (error) {
        console.error(
            `ERROR PROCESSING ${person.name}: ${errorMessage(error)}`,
        );

        return false;
    }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
    await Actor.init();

    const input =
        (await Actor.getInput()) as
            | Input
            | null;

    if (!input) {
        throw new Error(
            'Actor input is missing.',
        );
    }

    if (!input.startUrl) {
        throw new Error(
            'Missing startUrl.',
        );
    }

    if (!input.authState) {
        throw new Error(
            'Missing authState.',
        );
    }

    const maxPages =
        Math.max(
            0,
            input.maxPages ?? 0,
        );

    const maxProfiles =
        Math.max(
            0,
            input.maxProfiles ?? 0,
        );

    const startUrl =
        normalizeUrl(
            input.startUrl,
        );

    console.log('');
    console.log(
        '========================================',
    );
    console.log(
        'IMDbPro DIRECT CONTACT SCRAPER',
    );
    console.log(
        '========================================',
    );

    console.log(
        `DISCOVERY URL: ${startUrl}`,
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

    console.log(
        'DIRECT CONTACT LIMIT: NONE',
    );

    console.log(
        'DATASET SAVING: IMMEDIATE',
    );

    console.log(
        'COPY BUTTON SCOPE: DIRECT CONTACT ONLY',
    );

    // -------------------------------------------------------------------------
    // Parse authentication state
    // -------------------------------------------------------------------------

    let authState: any;

    try {
        authState =
            JSON.parse(
                input.authState,
            );
    } catch (error) {
        throw new Error(
            `Could not parse authState JSON: ${errorMessage(error)}`,
        );
    }

    console.log(
        `AUTH COOKIES: ${
            authState.cookies?.length ?? 0
        }`,
    );

    console.log(
        `AUTH ORIGINS: ${
            authState.origins?.length ?? 0
        }`,
    );

    // -------------------------------------------------------------------------
    // Browser
    // -------------------------------------------------------------------------

    const browser: Browser =
        await chromium.launch({
            headless: true,
        });

    const context: BrowserContext =
        await browser.newContext({
            storageState:
                authState,
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
            origin:
                'https://pro.imdb.com',
        },
    );

    const discoveryPage =
        await context.newPage();

    const profilePage =
        await context.newPage();

    try {
        // ---------------------------------------------------------------------
        // Authentication check
        // ---------------------------------------------------------------------

        console.log('');
        console.log(
            'CHECKING IMDbPro AUTHENTICATION...',
        );

        await discoveryPage.goto(
            startUrl,
            {
                waitUntil:
                    'domcontentloaded',
                timeout: 120_000,
            },
        );

        await discoveryPage.waitForTimeout(
            2_500,
        );

        console.log(
            `AUTH URL: ${discoveryPage.url()}`,
        );

        console.log(
            `AUTH TITLE: ${await discoveryPage.title()}`,
        );

        const authUrl =
            discoveryPage.url();

        const authTitle =
            await discoveryPage.title();

        if (
            /signin|login|ap\/signin/i.test(
                authUrl,
            )
            || /sign in|log in/i.test(
                authTitle,
            )
        ) {
            throw new Error(
                'IMDbPro authentication failed. The supplied authState is not authenticated.',
            );
        }

        console.log(
            'IMDbPro authentication check passed.',
        );

        // ---------------------------------------------------------------------
        // Counters
        // ---------------------------------------------------------------------

        const seenImdbIds =
            new Set<string>();

        let totalProfilesProcessed = 0;
        let totalContactsSaved = 0;

        let pageNumber = 1;

        // ---------------------------------------------------------------------
        // Continuous pagination.
        //
        // There is NO contact-count stopping condition.
        //
        // maxPages = 0 means unlimited.
        // maxProfiles = 0 means unlimited.
        // ---------------------------------------------------------------------

        while (true) {
            if (
                maxPages > 0
                && pageNumber > maxPages
            ) {
                console.log(
                    `REACHED MAX PAGES: ${maxPages}`,
                );

                break;
            }

            if (
                maxProfiles > 0
                && totalProfilesProcessed >=
                    maxProfiles
            ) {
                console.log(
                    `REACHED MAX PROFILES: ${maxProfiles}`,
                );

                break;
            }

            console.log('');
            console.log(
                '========================================',
            );
            console.log(
                `DISCOVERY PAGE ${pageNumber}`,
            );
            console.log(
                `DIRECT CONTACTS SAVED: ${totalContactsSaved}`,
            );
            console.log(
                '========================================',
            );

            // -----------------------------------------------------------------
            // Correctly construct the page URL.
            // -----------------------------------------------------------------

            const pageUrl =
                new URL(
                    startUrl,
                );

            pageUrl.searchParams.set(
                'pageNumber',
                String(pageNumber),
            );

            console.log(
                `OPENING: ${pageUrl.toString()}`,
            );

            let loaded = false;

            for (
                let attempt = 1;
                attempt <= 2;
                attempt++
            ) {
                try {
                    await discoveryPage.goto(
                        pageUrl.toString(),
                        {
                            waitUntil:
                                'domcontentloaded',
                            timeout: 120_000,
                        },
                    );

                    await discoveryPage
                        .waitForTimeout(
                            5_000,
                        );

                    loaded = true;
                    break;
                } catch (error) {
                    console.error(
                        `DISCOVERY LOAD ERROR ATTEMPT ${attempt}: ${errorMessage(error)}`,
                    );

                    if (
                        attempt < 2
                    ) {
                        await discoveryPage
                            .waitForTimeout(
                                2_000,
                            );
                    }
                }
            }

            if (!loaded) {
                console.error(
                    `COULD NOT LOAD DISCOVERY PAGE ${pageNumber}.`,
                );

                break;
            }

            console.log(
                `ACTUAL URL: ${discoveryPage.url()}`,
            );

            // -----------------------------------------------------------------
            // Find IMDb profile links.
            // -----------------------------------------------------------------

            const nameLinks =
                discoveryPage.locator(
                    'a[href*="/name/nm"]',
                );

            const count =
                await nameLinks
                    .count()
                    .catch(() => 0);

            console.log(
                `PROFILE LINKS FOUND: ${count}`,
            );

            if (count === 0) {
                console.log(
                    'NO PROFILE LINKS FOUND. STOPPING PAGINATION.',
                );

                break;
            }

            const peopleOnPage:
                Person[] = [];

            for (
                let i = 0;
                i < count;
                i++
            ) {
                if (
                    maxProfiles > 0
                    && totalProfilesProcessed
                        + peopleOnPage.length
                        >= maxProfiles
                ) {
                    break;
                }

                const link =
                    nameLinks.nth(i);

                const href =
                    await link
                        .getAttribute('href')
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
                    seenImdbIds.has(
                        imdbId,
                    )
                ) {
                    continue;
                }

                seenImdbIds.add(
                    imdbId,
                );

                const name =
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

                peopleOnPage.push({
                    imdbId,
                    name:
                        name ||
                        imdbId,
                    profileUrl,
                    discoveryPage:
                        pageNumber,
                });
            }

            console.log(
                `UNIQUE PROFILES ON PAGE: ${peopleOnPage.length}`,
            );

            // -----------------------------------------------------------------
            // Process profiles one at a time.
            // -----------------------------------------------------------------

            for (const person of peopleOnPage) {
                if (
                    maxProfiles > 0
                    && totalProfilesProcessed
                        >= maxProfiles
                ) {
                    break;
                }

                totalProfilesProcessed++;

                const saved =
                    await processProfile(
                        profilePage,
                        person,
                    );

                if (saved) {
                    totalContactsSaved++;

                    console.log(
                        `TOTAL DIRECT CONTACTS SAVED SO FAR: ${totalContactsSaved}`,
                    );
                }

                console.log(
                    `PROFILES PROCESSED SO FAR: ${totalProfilesProcessed}`,
                );
            }

            console.log('');
            console.log(
                `PAGE ${pageNumber} COMPLETE.`,
            );

            console.log(
                `PROFILES PROCESSED: ${totalProfilesProcessed}`,
            );

            console.log(
                `DIRECT CONTACTS SAVED: ${totalContactsSaved}`,
            );

            // -----------------------------------------------------------------
            // IMPORTANT:
            //
            // No contact target exists.
            // Continue to the next discovery page forever.
            // -----------------------------------------------------------------

            pageNumber++;
        }

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
            `PROFILES PROCESSED: ${totalProfilesProcessed}`,
        );

        console.log(
            `DIRECT CONTACTS SAVED: ${totalContactsSaved}`,
        );

        console.log(
            'DIRECT CONTACT LIMIT: NONE',
        );
    } finally {
        console.log(
            'Closing browser...',
        );

        await context
            .close()
            .catch(() => {});

        await browser
            .close()
            .catch(() => {});
    }

    await Actor.exit();
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

main().catch(
    async (error) => {
        console.error(
            `FATAL ERROR: ${errorMessage(error)}`,
        );

        await Actor.fail(
            errorMessage(error),
        );
    },
);
