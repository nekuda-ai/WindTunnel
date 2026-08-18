```javascript
/* ----------------------------------------------------------------------------
 * Easy!Appointments - Online Appointment Scheduler
 *
 * @package     EasyAppointments
 * @author      A.Tselegidis <alextselegidis@gmail.com>
 * @copyright   Copyright (c) Alex Tselegidis
 * @license     https://opensource.org/licenses/GPL-3.0 - GPLv3
 * @link        https://easyappointments.org
 * ---------------------------------------------------------------------------- */

/**
 * WebMCP tool: ask_site.
 *
 * Retrieval over the content bundle the server renders into `window.__WEBMCP_SITE_CONTENT__`
 * (see application/helpers/webmcp_helper.php). Matching happens in the browser - the site keeps no
 * search backend of its own.
 */

import {defineTool} from '@nekuda/webmcp';

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'any',
    'are',
    'at',
    'be',
    'can',
    'do',
    'does',
    'for',
    'from',
    'how',
    'i',
    'in',
    'is',
    'it',
    'long',
    'many',
    'me',
    'much',
    'my',
    'of',
    'on',
    'or',
    'that',
    'the',
    'there',
    'this',
    'to',
    'we',
    'what',
    'when',
    'where',
    'which',
    'who',
    'why',
    'with',
    'you',
    'your',
]);

/**
 * Read the content bundle the server rendered into the page.
 *
 * @return {Array} Returns the content sections.
 */
function contentSections() {
    const sections = window.__WEBMCP_SITE_CONTENT__;

    if (!Array.isArray(sections)) {
        throw new Error('This page did not publish the site content bundle, so there is nothing to search.');
    }

    return sections;
}

/**
 * Reduce a question to the terms worth matching on.
 *
 * @param {String} query Visitor question.
 *
 * @return {Array<String>} Returns the search terms.
 */
function searchTerms(query) {
    const terms = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

    return [...new Set(terms)];
}

/**
 * Score a section against the search terms.
 *
 * A term in the title counts for more than the same term in the body, so "opening hours" beats a
 * service description that happens to mention hours.
 *
 * @param {Object} section Content section.
 * @param {Array<String>} terms Search terms.
 *
 * @return {Number} Returns the score.
 */
function scoreSection(section, terms) {
    const title = section.title.toLowerCase();
    const text = section.text.toLowerCase();

    return terms.reduce((score, term) => {
        const occurrences = text.split(term).length - 1;

        return score + (title.includes(term) ? 5 : 0) + Math.min(occurrences, 3);
    }, 0);
}

export const askSite = defineTool({
    stableKey: 'site.ask',
    name: 'ask_site',
    title: 'Ask about this business',
    description:
        "Search this appointment booking site's own published information and return the sections that match, " +
        'each with its source. Covers the business name and contact details, opening hours, the services offered ' +
        'with their duration, price and description, the providers who deliver them, the booking rules (how far ' +
        'ahead you can book, how late you can still change an appointment), and the terms, privacy and cookie ' +
        'policies. Use this to answer any question about the business, its offering or its policies. Returns ' +
        'matching content sections as plain text plus a source label — it retrieves, it does not compose the answer.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: "The visitor's question, in their own words.",
                minLength: 1,
            },
            limit: {
                type: 'integer',
                description: 'How many matching sections to return.',
                minimum: 1,
                maximum: 20,
                default: 5,
            },
        },
        required: ['query'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: true, untrustedContentHint: false},
    async execute({query, limit = 5}) {
        const sections = contentSections();
        const terms = searchTerms(query);

        const scored = sections
            .map((section) => ({section, score: scoreSection(section, terms)}))
            .filter((entry) => entry.score > 0)
            .sort((first, second) => second.score - first.score)
            .slice(0, limit);

        if (!scored.length) {
            return {
                query,
                matches: [],
                note:
                    'Nothing on this site matches that question. The information published here covers: ' +
                    sections.map((section) => section.title).join('; ') +
                    '.',
            };
        }

        return {
            query,
            matches: scored.map(({section}) => ({
                title: section.title,
                source: section.source,
                text: section.text,
            })),
        };
    },
});
```
