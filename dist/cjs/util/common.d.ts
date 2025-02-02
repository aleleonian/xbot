export function loadEnvFromUrl(envUrl: any): Promise<void>;
export function createHash(inputString: any): string;
export function wait(ms: any): Promise<any>;
export function createErrorResponse(errorMessage: any): {
    success: boolean;
    errorMessage: any;
};
export function createSuccessResponse(data: any): {
    success: boolean;
    data: any;
};
export function debugLog(...strings: any[]): void;
export function errorLog(...strings: any[]): void;
