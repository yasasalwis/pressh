export declare const SDK_VERSION = "0.1.0";
export interface ManifestSpec {
    id: string;
    version: string;
    sdkVersion: string;
    dependencies?: Record<string, string>;
    needs?: readonly string[];
    declares?: {
        capabilities?: readonly string[];
        contentTypes?: readonly string[];
        endpoints?: ReadonlyArray<{
            path: string;
            method?: string;
        }>;
        adminPanels?: ReadonlyArray<{
            path: string;
            title: string;
        }>;
    };
    entry: string;
}
export declare function defineManifest(spec: ManifestSpec): ManifestSpec;
//# sourceMappingURL=index.d.ts.map