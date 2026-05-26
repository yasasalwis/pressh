export interface User {
    email: string;
    mustChangePassword?: boolean;
}

export interface Me {
    user: User;
    capabilities: string[];
    csrfToken: string;
}

export interface ApiError {
    error?: { code?: string; message?: string };
}
