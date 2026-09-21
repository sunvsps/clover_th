export interface paths {
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "ok";
                            /** @enum {string} */
                            db: "ok";
                            serverTime: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/discord/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/discord/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    code?: string;
                    state?: string;
                    error?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            memberId: string;
                            discordId: string;
                            ign: string;
                            nickname: string | null;
                            job: {
                                id: number;
                                label: string;
                                color: string;
                            };
                            isAdmin: boolean;
                            isIncomplete: boolean;
                            serverTime: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bot/members/{discordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    discordId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        ign: string;
                        job?: string;
                        jobId?: number;
                        nickname?: string | null;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            memberId: string;
                            discordId: string;
                            ign: string;
                            nickname: string | null;
                            job: {
                                id: number;
                                label: string;
                                color: string;
                            };
                            isActive: boolean;
                            isIncomplete: boolean;
                        };
                    };
                };
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            memberId: string;
                            discordId: string;
                            ign: string;
                            nickname: string | null;
                            job: {
                                id: number;
                                label: string;
                                color: string;
                            };
                            isActive: boolean;
                            isIncomplete: boolean;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bot/members/{discordId}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    discordId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            memberId: string;
                            /** @enum {boolean} */
                            isActive: false;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cursor?: number;
                    limit?: number;
                    actor?: string;
                    action?: string;
                    from?: string;
                    to?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: number;
                                at: string;
                                /** @enum {string} */
                                actorType: "MEMBER" | "BOT" | "SYSTEM";
                                actorId: string | null;
                                action: string;
                                entityType: string;
                                entityId: string;
                                meta: unknown;
                                requestId: string | null;
                            }[];
                            nextCursor: number | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            ign: string;
                            nickname: string | null;
                            jobId: number;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    incomplete?: "0" | "1" | "true" | "false";
                    includeInactive?: "0" | "1" | "true" | "false";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            ign: string;
                            nickname: string | null;
                            jobId: number;
                            discordId: string;
                            isActive: boolean;
                            isAdmin: boolean;
                            isIncomplete: boolean;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        ign?: string;
                        nickname?: string | null;
                        jobId?: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            ign: string;
                            nickname: string | null;
                            jobId: number;
                            discordId: string;
                            isActive: boolean;
                            isAdmin: boolean;
                            isIncomplete: boolean;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/admin/members/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            ign: string;
                            nickname: string | null;
                            jobId: number;
                            discordId: string;
                            isActive: boolean;
                            isAdmin: boolean;
                            isIncomplete: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{id}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            ign: string;
                            nickname: string | null;
                            jobId: number;
                            discordId: string;
                            isActive: boolean;
                            isAdmin: boolean;
                            isIncomplete: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            label: string;
                            color: string;
                            sortOrder: number;
                            inUse: boolean;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        jobs: {
                            id?: number;
                            label: string;
                            color: string;
                            sortOrder?: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            label: string;
                            color: string;
                            sortOrder: number;
                            inUse: boolean;
                        }[];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    status?: "PENDING" | "SENDING" | "SENT" | "DEAD";
                    eventType?: string;
                    cursor?: number;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: number;
                                eventType: string;
                                /** @enum {string} */
                                target: "DISCORD_DM" | "DISCORD_CHANNEL";
                                /** @enum {string} */
                                status: "PENDING" | "SENDING" | "SENT" | "DEAD";
                                attempts: number;
                                maxAttempts: number;
                                nextAttemptAt: string;
                                lastError: string | null;
                                lastErrorCode: string | null;
                                sentAt: string | null;
                                createdAt: string;
                                entityType: string | null;
                                entityId: string | null;
                                payload: unknown;
                            }[];
                            counts: {
                                PENDING: number;
                                SENDING: number;
                                SENT: number;
                                DEAD: number;
                            };
                            nextCursor: number | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/notifications/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            status: "PENDING";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            activityId: string;
                            name: string;
                            isGuild: boolean;
                            dayOfWeek: number;
                            startTime: string;
                            endTime: string;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/activities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            isGuild: boolean;
                            hasPlanner: boolean;
                            registrationCapacity: number | null;
                            autoBackfill: boolean;
                            notifyChannelId?: string | null;
                            layoutCapacity: number;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/activities/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        registrationCapacity?: number | null;
                        autoBackfill?: boolean;
                        notifyChannelId?: string | null;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            activity: {
                                id: string;
                                name: string;
                                isGuild: boolean;
                                hasPlanner: boolean;
                                registrationCapacity: number | null;
                                autoBackfill: boolean;
                                notifyChannelId?: string | null;
                                layoutCapacity: number;
                            };
                            promoted: {
                                occurrenceId: number;
                                memberId: string;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                    memberId: "me" | string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "JOINED" | "LEAVE" | "NONE";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "JOINED" | "WAITLISTED" | "LEAVE" | "NONE";
                            waitlistPosition: number | null;
                            promoted: string[];
                            backfilled: {
                                teamId: number;
                                teamName: string;
                                slot: number;
                                vacatedMemberId: string;
                                promotedMemberId: string;
                                /** @enum {string} */
                                reason: "UNREGISTERED" | "LEAVE" | "DEACTIVATED";
                            }[];
                            planVersion: number;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    from: string;
                    to: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            from: string;
                            to: string;
                            serverTime: string;
                            occurrences: {
                                [key: string]: {
                                    memberId: string;
                                    /** @enum {string} */
                                    status: "JOINED" | "WAITLISTED" | "LEAVE";
                                    waitlistPos?: number;
                                    placed?: boolean;
                                    reserveOrder?: number | null;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/activities/{id}/layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            activityId: string;
                            rooms: {
                                id: number;
                                key: string;
                                name: string;
                                sortOrder: number;
                                capacity: number;
                                teams: {
                                    id: number;
                                    name: string;
                                    size: number;
                                    sortOrder: number;
                                }[];
                            }[];
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        rooms: {
                            id?: number;
                            key: string;
                            name: string;
                            teams: {
                                id?: number;
                                name: string;
                                size: number;
                            }[];
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            activityId: string;
                            rooms: {
                                id: number;
                                key: string;
                                name: string;
                                sortOrder: number;
                                capacity: number;
                                teams: {
                                    id: number;
                                    name: string;
                                    size: number;
                                    sortOrder: number;
                                }[];
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            eventId: string;
                            date: string;
                            startsAt: string | null;
                            version: number;
                            autoBackfill: boolean;
                            rooms: {
                                id: number;
                                key: string;
                                name: string;
                                archived: boolean;
                                capacity: number;
                                teams: {
                                    id: number;
                                    name: string;
                                    size: number;
                                    archived: boolean;
                                    placements: {
                                        memberId: string;
                                        slot: number;
                                        /** @enum {string} */
                                        regStatus: "JOINED" | "WAITLISTED" | "LEAVE" | "NONE";
                                        /** @enum {string} */
                                        source: "ADMIN" | "COPY" | "AUTO_BACKFILL";
                                        backfill?: {
                                            vacatedMemberId: string | null;
                                            reason: string | null;
                                            at: string;
                                        };
                                    }[];
                                }[];
                            }[];
                            reserves: {
                                memberId: string;
                                registeredAt: string;
                                order: number;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/plan/placements/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                    memberId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        teamId: number | null;
                        slot?: number;
                        expectedVersion: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            version: number;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/plan/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        expectedVersion: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            version: number;
                            removed: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/plan/copy-from-previous": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        expectedVersion: number;
                        sourceDate?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            copied: number;
                            skipped: {
                                memberId: string;
                                /** @enum {string} */
                                reason: "MEMBER_INACTIVE" | "TEAM_REMOVED" | "SLOT_OUT_OF_RANGE";
                            }[];
                            version: number;
                            sourceDate: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences/{date}/plan/placements/{memberId}/undo-backfill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventId: string;
                    date: string;
                    memberId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        expectedVersion: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            version: number;
                            cancelledNotifications: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/auctions/rounds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        type: "LIVE_CLAIM";
                        name: string;
                        /** @default 300 */
                        durationSec?: number;
                        /** @default 5 */
                        winCap?: number;
                        /** @default 3 */
                        startDelaySec?: number;
                        items?: {
                            name: string;
                            /** @enum {string} */
                            category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                            rarity?: string | null;
                            imageUrl?: string | null;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/auctions/rounds/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        durationSec?: number;
                        winCap?: number;
                        startDelaySec?: number;
                        items?: {
                            name: string;
                            /** @enum {string} */
                            category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                            rarity?: string | null;
                            imageUrl?: string | null;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/admin/auctions/rounds/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        startDelaySec?: number;
                        durationSec?: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/auctions/rounds/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/auctions/rounds/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auctions/rounds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    status?: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            serverTime: string;
                            rounds: {
                                id: number;
                                /** @enum {string} */
                                type: "LIVE_CLAIM" | "QUEUE_RANKED";
                                name: string;
                                /** @enum {string} */
                                status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                                durationSec: number;
                                winCap: number | null;
                                startDelaySec: number;
                                opensAt: string | null;
                                closesAt: string | null;
                                itemCount: number;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auctions/rounds/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            /** @enum {string} */
                            type: "LIVE_CLAIM" | "QUEUE_RANKED";
                            name: string;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            durationSec: number;
                            winCap: number | null;
                            startDelaySec: number;
                            opensAt: string | null;
                            closesAt: string | null;
                            serverTime: string;
                            items: {
                                id: number;
                                name: string;
                                /** @enum {string} */
                                category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                                rarity: string | null;
                                imageUrl: string | null;
                                winner: {
                                    memberId: string;
                                    wonAt: string;
                                } | null;
                            }[];
                            myWinCount: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auctions/rounds/{id}/items/{itemId}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                    itemId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            item: {
                                id: number;
                                name: string;
                                /** @enum {string} */
                                category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                                rarity: string | null;
                                imageUrl: string | null;
                                winner: {
                                    memberId: string;
                                    wonAt: string;
                                } | null;
                            };
                            myWinCount: number;
                        };
                    };
                };
            };
        };
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                    itemId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            item: {
                                id: number;
                                name: string;
                                /** @enum {string} */
                                category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                                rarity: string | null;
                                imageUrl: string | null;
                                winner: {
                                    memberId: string;
                                    wonAt: string;
                                } | null;
                            };
                            myWinCount: number;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auctions/rounds/{id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            roundId: number;
                            /** @enum {string} */
                            status: "CLOSED";
                            closedAt: string | null;
                            serverTime: string;
                            items: {
                                id: number;
                                name: string;
                                /** @enum {string} */
                                category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                                rarity: string | null;
                                imageUrl: string | null;
                                winner: {
                                    memberId: string;
                                    wonAt: string;
                                } | null;
                            }[];
                            leftoverRoundId: number | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auctions/rounds/{id}/results/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            roundId: number;
                            /** @enum {string} */
                            status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
                            serverTime: string;
                            items: {
                                id: number;
                                name: string;
                                /** @enum {string} */
                                category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
                                rarity: string | null;
                                imageUrl: string | null;
                                winner: {
                                    memberId: string;
                                    wonAt: string;
                                } | null;
                            }[];
                            myWinCount: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
