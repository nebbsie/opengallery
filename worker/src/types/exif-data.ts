export interface ExifData {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
  Make?: string;
  Model?: string;
  LensModel?: string;
  ISO?: number;
  ExposureTime?: number | string;
  FNumber?: number;
  FocalLength?: number;
  FocalLengthIn35mmFormat?: number;
  ExposureTimeValue?: number | string;
  latitude?: number;
  longitude?: number;
}
