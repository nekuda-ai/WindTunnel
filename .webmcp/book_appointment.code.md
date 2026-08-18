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
 * WebMCP tool: book_appointment.
 *
 * Fills the booking wizard the way a visitor would, lets the wizard assemble and validate its own
 * payload, and posts it to the site's own registration route.
 */

import {defineTool} from '@nekuda/webmcp';
import {ANY_PROVIDER, findService, isManageMode, requireBookingWizard, resolveProviderId} from './support.js';
import {
    advanceToConfirmation,
    confirmationUrl,
    fillCustomerForm,
    readPostData,
    requireConsentGiven,
    selectHour,
    selectServiceProviderDate,
    selectedTimezone,
    submitRegistration,
} from './wizard.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export const bookAppointment = defineTool({
    stableKey: 'booking.appointment.create',
    name: 'book_appointment',
    title: 'Book an appointment',
    description:
        "Book an appointment for a service at a specific date and time using the visitor's contact details. This " +
        "creates a real appointment in the business's schedule and sends a confirmation email, so check the slot " +
        'with check_availability first. First name, last name and email are required; phone number, address, city, ' +
        'zip code and notes are optional. The page then moves to the booking confirmation. Returns the ' +
        "appointment's confirmation hash — that hash is what reschedule_appointment and cancel_appointment work " +
        'from, so keep it.',
    inputSchema: {
        type: 'object',
        properties: {
            service_id: {type: 'integer', description: 'The service being booked, from list_services.'},
            date: {
                type: 'string',
                description: 'The appointment day, as YYYY-MM-DD.',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            time: {
                type: 'string',
                description: 'The start time as HH:mm, exactly as check_availability returned it.',
                pattern: '^\\d{2}:\\d{2}$',
            },
            first_name: {type: 'string', description: "The visitor's first name.", minLength: 1},
            last_name: {type: 'string', description: "The visitor's last name.", minLength: 1},
            email: {type: 'string', description: 'Email address the confirmation is sent to.', minLength: 3},
            provider_id: {
                description:
                    'Optional. A specific provider id, or "any-provider" to let the business pick. Defaults to the ' +
                    'first provider who offers the service.',
                anyOf: [{type: 'integer'}, {type: 'string', enum: [ANY_PROVIDER]}],
            },
            phone_number: {type: 'string', description: 'Phone number. Some sites require it.'},
            address: {type: 'string', description: 'Street address.'},
            city: {type: 'string', description: 'City.'},
            zip_code: {type: 'string', description: 'Postcode.'},
            notes: {type: 'string', description: 'Anything the provider should know before the appointment.'},
            timezone: {
                type: 'string',
                description: 'Timezone the visitor reads times in, e.g. "Europe/Berlin". Defaults to the page\'s.',
            },
        },
        required: ['service_id', 'date', 'time', 'first_name', 'last_name', 'email'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: false, untrustedContentHint: false},
    async execute(input) {
        requireBookingWizard();

        if (isManageMode()) {
            throw new Error(
                'This page is showing an existing appointment. Use reschedule_appointment to change it, or open the ' +
                    "site's booking page to make a new booking.",
            );
        }

        if (!DATE_PATTERN.test(input.date)) {
            throw new Error(`"${input.date}" is not a date. Pass the day as YYYY-MM-DD.`);
        }

        if (!TIME_PATTERN.test(input.time)) {
            throw new Error(`"${input.time}" is not a time. Pass the start time as HH:mm.`);
        }

        const service = findService(input.service_id);
        const providerId = resolveProviderId(input.service_id, input.provider_id);

        // The timezone select reloads the slot list when it changes, so it has to be settled before a
        // slot is picked - otherwise the re-render would drop the selection.
        fillCustomerForm({'select-timezone': input.timezone});

        await selectServiceProviderDate(String(service.id), providerId, input.date);

        selectHour(input.time, input.date);

        fillCustomerForm({
            'first-name': input.first_name,
            'last-name': input.last_name,
            email: input.email,
            'phone-number': input.phone_number,
            address: input.address,
            city: input.city,
            'zip-code': input.zip_code,
            notes: input.notes,
        });

        await advanceToConfirmation();

        requireConsentGiven();

        const postData = readPostData();
        const response = await submitRegistration(postData);
        const url = confirmationUrl(response.appointment_hash);

        window.location.assign(url);

        return {
            appointment_hash: response.appointment_hash,
            service: {service_id: Number(service.id), name: service.name},
            provider_id: providerId,
            start_datetime: postData.appointment.start_datetime,
            end_datetime: postData.appointment.end_datetime,
            displayed_timezone: selectedTimezone(),
            confirmation_url: url,
            manage_url: `${url.replace('booking_confirmation/of/', 'booking/reschedule/')}`,
        };
    },
});
```
