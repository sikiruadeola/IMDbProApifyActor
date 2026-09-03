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
}

interface DirectContactResult {
    imdbId: string;
    name: string;
    profileUrl: string;
    email: string;
}

const TARGET_CONTACTS = 2;

const DISCOVERY_WAIT_MS = 5000;
const PROFILE_WAIT_MS = 3000;
const DIRECT_CONTACT_WAIT_MS = 2500;

function errorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : String(error);
}

function normalizeText(
    value: string | null | undefined,
): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractImdbId(
    url: string,
): string | null {
    const match = url.match(
        /\/name\/(nm\d+)/i,
    );

    return match
        ? match[1]
        : null;
}

function extractEmail(
    value: string,
): string | null {
    const match = value.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );

    return match
        ? match[0].trim()
        : null;
}

function parseAuthState(
    value: unknown,
): any {
    if (
        value === null ||
        value === undefined
    ) {
        throw new Error(
            'authState is required.',
        );
    }

    let parsed: unknown = value;

    if (
        typeof value === 'string'
    ) {
        const text = value.trim();

        if (!text) {
            throw new Error(
                'authState is empty.',
            );
        }

        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throw new Error(
                `Could not parse authState JSON: ${errorMessage(error)}`,
            );
        }
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            'authState must be a Playwright storage-state JSON object.',
        );
    }

    const state =
        parsed as Record<string, unknown>;

    if (
        !Array.isArray(state.cookies)
    ) {
        throw new Error(
            'authState.cookies must be an array.',
        );
    }

    if (
        !Array.isArray(state.origins)
    ) {
        throw new Error(
            'authState.origins must be an array.',
        );
    }

    return state;
}

async function isVisible(
    locator: Locator,
): Promise<boolean> {
    try {
        return await locator.isVisible();
    } catch {
        return false;
    }
}

async function getVisibleLocators(
    root: Locator,
    selector: string,
): Promise<Locator[]> {
    const locator =
        root.locator(selector);

    const count =
        await locator
            .count()
            .catch(() => 0);

    const result: Locator[] = [];

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
            result.push(candidate);
        }
    }

    return result;
}

async function safeClick(
    locator: Locator,
): Promise<boolean> {
    try {
        await locator
            .scrollIntoViewIfNeeded()
            .catch(() => {});

        await locator.click({
            timeout: 15000,
        });

        return true;
    } catch {
        try {
            await locator.click({
                timeout: 15000,
                force: true,
            });

            return true;
        } catch {
            return false;
        }
    }
}

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
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                page.locator('body'),
                selector,
            );

        for (
            const candidate of candidates
        ) {
            const text =
                normalizeText(
                    await candidate
                        .innerText()
                        .catch(() => ''),
                );

            const aria =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'aria-label',
                        )
                        .catch(() => null),
                );

            const title =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'title',
                        )
                        .catch(() => null),
                );

            if (
                /direct\s*contact/i.test(
                    `${text} ${aria} ${title}`,
                )
            ) {
                console.log(
                    `DIRECT CONTACT CONTROL FOUND USING: ${selector}`,
                );

                return candidate;
            }
        }
    }

    return null;
}

async function findContactTab(
    page: Page,
): Promise<Locator | null> {
    console.log(
        'SEARCHING FOR CONTACT TAB/CONTROL...',
    );

    const selectors = [
        'button:has-text("Contact")',
        '[role="button"]:has-text("Contact")',
        'a:has-text("Contact")',
        '[aria-label*="Contact" i]',
        '[title*="Contact" i]',
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                page.locator('body'),
                selector,
            );

        for (
            const candidate of candidates
        ) {
            const text =
                normalizeText(
                    await candidate
                        .innerText()
                        .catch(() => ''),
                );

            const aria =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'aria-label',
                        )
                        .catch(() => null),
                );

            const title =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'title',
                        )
                        .catch(() => null),
                );

            const combined =
                `${text} ${aria} ${title}`;

            if (
                /contact/i.test(
                    combined,
                ) &&
                !/direct\s*contact/i.test(
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
        'button:has-text("Direct Contact")',
        '[role="button"]:has-text("Direct Contact")',
        'a:has-text("Direct Contact")',
        '[aria-label*="Direct Contact" i]',
        '[title*="Direct Contact" i]',
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                page.locator('body'),
                selector,
            );

        for (
            const candidate of candidates
        ) {
            const text =
                normalizeText(
                    await candidate
                        .innerText()
                        .catch(() => ''),
                );

            const aria =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'aria-label',
                        )
                        .catch(() => null),
                );

            const title =
                normalizeText(
                    await candidate
                        .getAttribute(
                            'title',
                        )
                        .catch(() => null),
                );

            if (
                /direct\s*contact/i.test(
                    `${text} ${aria} ${title}`,
                )
            ) {
                return candidate;
            }
        }
    }

    return null;
}

async function findCopyButton(
    root: Locator,
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
        'svg[aria-label*="copy" i]',
        '[data-icon*="copy" i]',
    ];

    for (
        const selector of selectors
    ) {
        const candidates =
            await getVisibleLocators(
                root,
                selector,
            );

        if (
            candidates.length > 0
        ) {
            console.log(
                `COPY BUTTON FOUND USING: ${selector}`,
            );

            return candidates[0];
        }
    }

    return null;
}

async function findDirectContactContainer(
    page: Page,
    directContact: Locator,
): Promise<Locator> {
    let current =
        directContact;

    for (
        let level = 0;
        level < 8;
        level++
    ) {
        const text =
            normalizeText(
                await current
                    .innerText()
                    .catch(() => ''),
            );

        const copyButton =
            await findCopyButton(
                current,
            );

        if (
            /direct\s*contact/i.test(
                text,
            ) &&
            copyButton
        ) {
            console.log(
                `DIRECT CONTACT CONTAINER FOUND AT LEVEL ${level}.`,
            );

            return current;
        }

        const parent =
            current.locator(
                'xpath=..',
            );

        if (
            await parent
                .count()
                .catch(() => 0) === 0
        ) {
            break;
        }

        current =
            parent;
    }

    return page.locator('body');
}

async function clearClipboard(
    page: Page,
): Promise<void> {
    try {
        await page.evaluate(
            async () => {
                try {
                    await navigator.clipboard.writeText('');
                } catch {
                    // Ignore.
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
                        return await navigator.clipboard.readText();
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

async function extractDirectContactEmail(
    page: Page,
): Promise<string | null> {
    let directContact =
        await findDirectContactControl(
            page,
        );

    if (
        !directContact
    ) {
        console.log(
            'DIRECT CONTACT CONTROL NOT FOUND DIRECTLY.',
        );

        const contactTab =
            await findContactTab(
                page,
            );

        if (
            contactTab
        ) {
            console.log(
                'CONTACT TAB FOUND. CLICKING IT...',
            );

            const clicked =
                await safeClick(
                    contactTab,
                );

            if (
                clicked
            ) {
                await page.waitForTimeout(
                    DIRECT_CONTACT_WAIT_MS,
                );
            }
        }
    }

    directContact =
        await findDirectContactControl(
            page,
        );

    if (
        !directContact
    ) {
        directContact =
            await findDirectContactText(
                page,
            );
    }

    if (
        !directContact
    ) {
        console.log(
            'DIRECT CONTACT WAS NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT FOUND.',
    );

    const tagName =
        await directContact
            .evaluate(
                (element) =>
                    element.tagName.toLowerCase(),
            )
            .catch(() => '');

    if (
        tagName === 'button' ||
        tagName === 'a' ||
        tagName === 'summary'
    ) {
        console.log(
            'DIRECT CONTACT IS INTERACTIVE. OPENING IT...',
        );

        const clicked =
            await safeClick(
                directContact,
            );

        if (
            clicked
        ) {
            await page.waitForTimeout(
                DIRECT_CONTACT_WAIT_MS,
            );
        }
    }

    const refreshedDirectContact =
        await findDirectContactText(
            page,
        );

    const container =
        refreshedDirectContact
            ? await findDirectContactContainer(
                page,
                refreshedDirectContact,
            )
            : page.locator('body');

    let copyButton =
        await findCopyButton(
            container,
        );

    if (
        !copyButton
    ) {
        console.log(
            'COPY BUTTON NOT FOUND INSIDE DIRECT CONTACT CONTAINER.',
        );

        console.log(
            'CHECKING DIRECT CONTACT ROOT...',
        );

        copyButton =
            await findCopyButton(
                refreshedDirectContact
                    ? refreshedDirectContact
                    : page.locator('body'),
            );
    }

    if (
        !copyButton
    ) {
        console.log(
            'DIRECT CONTACT COPY BUTTON NOT FOUND.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT COPY BUTTON FOUND.',
    );

    await clearClipboard(page);

    console.log(
        'CLICKING DIRECT CONTACT COPY BUTTON...',
    );

    const clicked =
        await safeClick(
            copyButton,
        );

    if (
        !clicked
    ) {
        console.log(
            'DIRECT CONTACT COPY BUTTON CLICK FAILED.',
        );

        return null;
    }

    await page.waitForTimeout(
        1000,
    );

    const clipboardText =
        await readClipboard(
            page,
        );

    if (
        !clipboardText
    ) {
        console.log(
            'DIRECT CONTACT CLIPBOARD IS EMPTY.',
        );

        return null;
    }

    console.log(
        'DIRECT CONTACT CLIPBOARD RECEIVED.',
    );

    const email =
        extractEmail(
            clipboardText,
        );

    if (
        !email
    ) {
        console.log(
            'COPIED DIRECT CONTACT DOES NOT CONTAIN AN EMAIL.',
        );

        return null;
    }

    console.log(
        `DIRECT CONTACT EMAIL CONFIRMED: ${email}`,
    );

    return email;
}

async function getProfileName(
    page: Page,
): Promise<string> {
    const selectors = [
        'h1',
        '[data-testid*="name-header" i] h1',
    ];

    for (
        const selector of selectors
    ) {
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
                text &&
                text.length < 200
            ) {
                return text;
            }
        }
    }

    return '';
}

async function processProfile(
    context: BrowserContext,
    person: Person,
): Promise<DirectContactResult | null> {
    const page =
        await context.newPage();

    try {
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
            await page.goto(
                person.profileUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60000,
                },
            );
        } catch (error) {
            console.log(
                `PROFILE NAVIGATION FAILED: ${errorMessage(error)}`,
            );

            return null;
        }

        await page.waitForTimeout(
            PROFILE_WAIT_MS,
        );

        console.log(
            `PROFILE ACTUAL URL: ${page.url()}`,
        );

        if (
            /signin|login|ap\/signin/i.test(
                page.url(),
            )
        ) {
            console.log(
                'PROFILE REDIRECTED TO LOGIN.',
            );

            return null;
        }

        const email =
            await extractDirectContactEmail(
                page,
            );

        if (
            !email
        ) {
            console.log(
                'NO VALID DIRECT CONTACT EMAIL.',
            );

            console.log(
                'NOT SAVED.',
            );

            return null;
        }

        const name =
            await getProfileName(
                page,
            );

        return {
            imdbId:
                person.imdbId,
            name,
            profileUrl:
                person.profileUrl,
            email,
        };
    } catch (error) {
        console.log(
            `PROFILE ERROR: ${errorMessage(error)}`,
        );

        return null;
    } finally {
        await page.close().catch(() => {});
    }
}

async function findProfileLinks(
    page: Page,
): Promise<string[]> {
    const hrefs =
        await page
            .locator(
                'a[href*="/name/nm"]',
            )
            .evaluateAll(
                (anchors) =>
                    anchors
                        .map(
                            (anchor) =>
                                (
                                    anchor as HTMLAnchorElement
                                ).href,
                        )
                        .filter(Boolean),
            )
            .catch(() => []);

    return [
        ...new Set(hrefs),
    ];
}

function buildDiscoveryUrl(
    startUrl: string,
    pageNumber: number,
): string {
    const url =
        new URL(startUrl);

    url.searchParams.set(
        'pageNumber',
        String(pageNumber),
    );

    return url.toString();
}

async function main(): Promise<void> {
    await Actor.init();

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

    const input =
        (await Actor.getInput()) as Input | null;

    if (
        !input
    ) {
        throw new Error(
            'No Actor input was provided.',
        );
    }

    if (
        typeof input.startUrl !==
            'string' ||
        !input.startUrl.trim()
    ) {
        throw new Error(
            'Missing startUrl.',
        );
    }

    if (
        input.authState ===
            undefined ||
        input.authState ===
            null ||
        (
            typeof input.authState ===
                'string' &&
            !input.authState.trim()
        )
    ) {
        throw new Error(
            'Missing authState.',
        );
    }

    const maxPagesInput =
        Number(
            input.maxPages ?? 0,
        );

    const maxPages =
        maxPagesInput > 0
            ? Math.floor(
                maxPagesInput,
            )
            : Infinity;

    console.log(
        `DISCOVERY URL: ${input.startUrl}`,
    );

    console.log(
        `MAX PAGES: ${
            Number.isFinite(maxPages)
                ? maxPages
                : 'UNLIMITED'
        }`,
    );

    console.log(
        `TARGET DIRECT CONTACTS: ${TARGET_CONTACTS}`,
    );

    console.log(
        'PROFILE LIMIT: IGNORED FOR STOP CONDITION.',
    );

    const authState =
        parseAuthState(
            input.authState,
        );

    console.log(
        `AUTH COOKIES: ${authState.cookies.length}`,
    );

    console.log(
        `AUTH ORIGINS: ${authState.origins.length}`,
    );

    const browser: Browser =
        await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        });

    const context =
        await browser.newContext({
            storageState:
                authState as any,

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

    let totalProcessed = 0;
    let totalSaved = 0;

    try {
        console.log('');
        console.log(
            'CHECKING IMDbPro AUTHENTICATION...',
        );

        const authPage =
            await context.newPage();

        try {
            await authPage.goto(
                input.startUrl,
                {
                    waitUntil:
                        'domcontentloaded',
                    timeout: 60000,
                },
            );

            await authPage.waitForTimeout(
                3000,
            );

            console.log(
                `AUTH URL: ${authPage.url()}`,
            );

            console.log(
                `AUTH TITLE: ${await authPage.title()}`,
            );

            if (
                /signin|login|ap\/signin/i.test(
                    authPage.url(),
                )
            ) {
                throw new Error(
                    'IMDbPro authentication appears to be invalid or expired.',
                );
            }

            console.log(
                'IMDbPro authentication check passed.',
            );
        } finally {
            await authPage
                .close()
                .catch(() => {});
        }

        const processedIds =
            new Set<string>();

        let reachedEnd =
            false;

        for (
            let pageNumber = 1;
            pageNumber <= maxPages;
            pageNumber++
        ) {
            if (
                totalSaved >=
                TARGET_CONTACTS
            ) {
                console.log(
                    `TARGET REACHED: ${TARGET_CONTACTS} DIRECT CONTACTS SAVED.`,
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
                `DIRECT CONTACTS SAVED: ${totalSaved}/${TARGET_CONTACTS}`,
            );
            console.log(
                '========================================',
            );

            const discoveryPage =
                await context.newPage();

            try {
                const discoveryUrl =
                    buildDiscoveryUrl(
                        input.startUrl,
                        pageNumber,
                    );

                console.log(
                    `OPENING: ${discoveryUrl}`,
                );

                let loaded =
                    false;

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
                                timeout: 60000,
                            },
                        );

                        loaded =
                            true;

                        break;
                    } catch (error) {
                        console.log(
                            `DISCOVERY ATTEMPT ${attempt} FAILED: ${errorMessage(error)}`,
                        );

                        if (
                            attempt === 1
                        ) {
                            await discoveryPage.waitForTimeout(
                                2000,
                            );
                        }
                    }
                }

                if (
                    !loaded
                ) {
                    console.log(
                        'DISCOVERY PAGE FAILED.',
                    );

                    continue;
                }

                await discoveryPage.waitForTimeout(
                    DISCOVERY_WAIT_MS,
                );

                console.log(
                    `ACTUAL URL: ${discoveryPage.url()}`,
                );

                const profileLinks =
                    await findProfileLinks(
                        discoveryPage,
                    );

                console.log(
                    `PROFILE LINKS FOUND: ${profileLinks.length}`,
                );

                if (
                    profileLinks.length === 0
                ) {
                    console.log(
                        'NO PROFILE LINKS FOUND.',
                    );

                    reachedEnd =
                        true;

                    break;
                }

                for (
                    const profileUrl of profileLinks
                ) {
                    if (
                        totalSaved >=
                        TARGET_CONTACTS
                    ) {
                        console.log(
                            `TARGET REACHED: ${TARGET_CONTACTS}. STOPPING.`,
                        );

                        break;
                    }

                    const imdbId =
                        extractImdbId(
                            profileUrl,
                        );

                    if (
                        !imdbId
                    ) {
                        continue;
                    }

                    if (
                        processedIds.has(
                            imdbId,
                        )
                    ) {
                        continue;
                    }

                    processedIds.add(
                        imdbId,
                    );

                    totalProcessed++;

                    const person: Person = {
                        imdbId,
                        name: '',
                        profileUrl:
                            `https://pro.imdb.com/name/${imdbId}/`,
                    };

                    const result =
                        await processProfile(
                            context,
                            person,
                        );

                    if (
                        !result
                    ) {
                        console.log(
                            `NO DIRECT CONTACT SAVED FOR ${imdbId}.`,
                        );

                        continue;
                    }

                    await Actor.pushData({
                        imdbId:
                            result.imdbId,
                        name:
                            result.name,
                        profileUrl:
                            result.profileUrl,
                        email:
                            result.email,
                    });

                    totalSaved++;

                    console.log('');
                    console.log(
                        '****************************************',
                    );
                    console.log(
                        'DIRECT CONTACT SAVED',
                    );
                    console.log(
                        `CONTACT ${totalSaved}/${TARGET_CONTACTS}`,
                    );
                    console.log(
                        `IMDb ID: ${result.imdbId}`,
                    );
                    console.log(
                        `NAME: ${result.name}`,
                    );
                    console.log(
                        `EMAIL: ${result.email}`,
                    );
                    console.log(
                        '****************************************',
                    );

                    if (
                        totalSaved >=
                        TARGET_CONTACTS
                    ) {
                        console.log('');
                        console.log(
                            `STOPPING: ${TARGET_CONTACTS} DIRECT CONTACTS HAVE BEEN SAVED.`,
                        );

                        break;
                    }
                }
            } finally {
                await discoveryPage
                    .close()
                    .catch(() => {});
            }

            if (
                reachedEnd
            ) {
                break;
            }
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
            `PROFILES PROCESSED: ${totalProcessed}`,
        );

        console.log(
            `DIRECT CONTACTS SAVED: ${totalSaved}`,
        );

        console.log(
            `TARGET: ${TARGET_CONTACTS}`,
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

    await Actor.exit(
        `Finished. Saved ${totalSaved} Direct Contact records.`,
    );
}

main().catch(
    async (error) => {
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

        const message =
            errorMessage(error);

        console.error(
            message,
        );

        await Actor.fail(
            message,
        );
    },
);
