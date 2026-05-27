export interface User {
    email: string;
    mustChangePassword?: boolean;
    mfaEnabled?: boolean;
}

export interface Me {
    user: User;
    capabilities: string[];
    csrfToken: string;
}

export interface ApiError {
    error?: { code?: string; message?: string };
}
