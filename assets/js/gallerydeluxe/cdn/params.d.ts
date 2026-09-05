declare module "@params" {
  export const shuffle: boolean | undefined;
  export const reverse: boolean | undefined;
  export const enable_exif: boolean | undefined;
  export const gallery_data_url: string | undefined;
  const allParams: Record<string, unknown>;
  export default allParams;
}
