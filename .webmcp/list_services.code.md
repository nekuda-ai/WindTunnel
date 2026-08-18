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
 * WebMCP tool: list_services.
 *
 * Reads the booking page's own service and provider lists - the exact arrays the wizard renders its
 * first step from - so the agent and the visitor always see the same catalogue.
 */

import {defineTool} from '@nekuda/webmcp';
import {availableProviders, availableServices, requireBookingWizard} from './support.js';

/**
 * Describe the providers that offer a service.
 *
 * @param {Number|String} serviceId Service ID.
 *
 * @return {Array<Object>} Returns the matching providers.
 */
function providersForService(serviceId) {
    return availableProviders()
        .filter((provider) => (provider.services ?? []).map(Number).includes(Number(serviceId)))
        .map((provider) => ({
            provider_id: Number(provider.id),
            name: `${provider.first_name} ${provider.last_name}`.trim(),
            timezone: provider.timezone,
        }));
}

export const listServices = defineTool({
    stableKey: 'booking.services.list',
    name: 'list_services',
    title: 'List bookable services',
    description:
        'List the services this business offers for online booking. Each entry gives the service id, name, ' +
        'description, duration in minutes, price and currency, and the providers who deliver it with their ids and ' +
        'timezone. Use this first to identify the service the visitor means and to get the service_id and ' +
        'provider_id that check_availability and book_appointment need. Optionally filter by a name fragment. ' +
        'Read-only — the page does not change.',
    inputSchema: {
        type: 'object',
        properties: {
            name_contains: {
                type: 'string',
                description: 'Only return services whose name or description contains this text.',
                minLength: 1,
            },
        },
        required: [],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: true, untrustedContentHint: false},
    async execute({name_contains: nameContains} = {}) {
        requireBookingWizard();

        const services = availableServices();

        const describe = (service) => ({
            service_id: Number(service.id),
            name: service.name,
            description: service.description ?? null,
            duration_minutes: Number(service.duration),
            price: Number(service.price),
            currency: service.currency,
            category: service.service_category_name ?? null,
            location: service.location ?? null,
            providers: providersForService(service.id),
        });

        if (!nameContains) {
            return {services: services.map(describe)};
        }

        const needle = nameContains.toLowerCase();

        const matches = services.filter(
            (service) =>
                service.name.toLowerCase().includes(needle) ||
                (service.description ?? '').toLowerCase().includes(needle),
        );

        if (!matches.length) {
            return {
                services: [],
                note:
                    `No bookable service matches "${nameContains}". This business offers: ` +
                    services.map((service) => service.name).join(', ') +
                    '.',
            };
        }

        return {services: matches.map(describe)};
    },
});
```
