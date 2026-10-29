import type {Plan, Site} from './types';

/**
 * 真实的太阳位置：按城市经纬度、日期和北京时间算太阳方位角和高度角（NOAA 简化公式，误差在 1° 以内）。
 * 再按户型的朝向（图纸上方指向哪里）换算成平面图和 3D 场景里的方向。
 */

/** 没设置时的默认位置：上海，图纸上方朝北 */
export const DEFAULT_SITE: Site = {city: '上海', lat: 31.23, lng: 121.47, north: 0};

/** 常用城市：名称、纬度、经度 */
export const CITIES: [string, number, number][] = [
  ['北京', 39.9, 116.4], ['上海', 31.23, 121.47], ['广州', 23.13, 113.26], ['深圳', 22.54, 114.06],
  ['天津', 39.13, 117.2], ['重庆', 29.56, 106.55], ['成都', 30.66, 104.07], ['杭州', 30.27, 120.16],
  ['南京', 32.06, 118.8], ['苏州', 31.3, 120.62], ['武汉', 30.59, 114.31], ['西安', 34.34, 108.94],
  ['长沙', 28.23, 112.94], ['郑州', 34.75, 113.63], ['济南', 36.65, 117.12], ['青岛', 36.07, 120.38],
  ['合肥', 31.82, 117.23], ['福州', 26.07, 119.3], ['厦门', 24.48, 118.09], ['南昌', 28.68, 115.86],
  ['宁波', 29.87, 121.55], ['无锡', 31.49, 120.31], ['东莞', 23.02, 113.75], ['佛山', 23.02, 113.12],
  ['珠海', 22.27, 113.58], ['南宁', 22.82, 108.37], ['海口', 20.04, 110.32], ['昆明', 25.04, 102.71],
  ['贵阳', 26.65, 106.63], ['沈阳', 41.8, 123.43], ['大连', 38.91, 121.61], ['长春', 43.82, 125.32],
  ['哈尔滨', 45.8, 126.53], ['石家庄', 38.04, 114.51], ['太原', 37.87, 112.55], ['呼和浩特', 40.84, 111.75],
  ['兰州', 36.06, 103.83], ['西宁', 36.62, 101.78], ['银川', 38.49, 106.23], ['乌鲁木齐', 43.83, 87.62],
  ['拉萨', 29.65, 91.11], ['香港', 22.32, 114.17], ['台北', 25.03, 121.57],
];

/** 常用日子：一年里第几天 */
export const SUN_DAYS = {
  winter: {label: '冬至', doy: 355},
  equinox: {label: '春分', doy: 79},
  summer: {label: '夏至', doy: 172},
} as const;
export type SunDayKey = keyof typeof SUN_DAYS | 'today';

export function dayOfYear(d = new Date()): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
}

export const siteOf = (plan: Plan): Site => plan.site ?? DEFAULT_SITE;

const RAD = Math.PI / 180;

/**
 * 太阳位置。hour 是北京时间（东八区）的钟点，可以带小数。
 * az 从正北顺时针量，el 是高度角，都是弧度；el 小于 0 表示在地平线以下。
 */
export function solarPosition(site: Pick<Site, 'lat' | 'lng'>, doy: number, hour: number, tz = 8): {az: number; el: number} {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueSolarMin = hour * 60 + eqTime + 4 * site.lng - 60 * tz;
  const ha = (trueSolarMin / 4 - 180) * RAD;
  const lat = site.lat * RAD;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cosZen)));
  // 从正南起量、向西为正，再转成从正北顺时针
  const fromSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const az = (fromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI);
  return {az, el};
}

/** 日出日落的钟点（北京时间），5 分钟精度；极昼极夜返回 null */
export function daylight(site: Pick<Site, 'lat' | 'lng'>, doy: number): [number, number] | null {
  let rise: number | null = null;
  let set: number | null = null;
  for (let m = 0; m <= 24 * 60; m += 5) {
    const up = solarPosition(site, doy, m / 60).el > 0;
    if (up && rise === null) rise = m / 60;
    if (up) set = m / 60;
  }
  return rise === null || set === null || (rise === 0 && set === 24) ? null : [rise, set];
}

/**
 * 太阳在平面图上的水平方向（单位向量，指向太阳）。
 * north 是「图纸上方」顺时针转多少度才是正北；平面坐标 y 朝下，所以图纸上方是 (0, -1)。
 */
export function sunDirOnPlan(az: number, north: number): [number, number] {
  const a = az + north * RAD;
  return [Math.sin(a), -Math.cos(a)];
}

/** 指南针：正北在平面图上的方向 */
export function northOnPlan(north: number): [number, number] {
  return sunDirOnPlan(0, north);
}

/** 3D 场景里指向太阳的单位向量（平面 x → x，平面 y → z，y 朝上） */
export function sunDir3D(site: Site, doy: number, hour: number): {dir: [number, number, number]; el: number} {
  const {az, el} = solarPosition(site, doy, hour);
  const [dx, dy] = sunDirOnPlan(az, site.north);
  const c = Math.cos(el);
  return {dir: [dx * c, Math.sin(el), dy * c], el};
}

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
/** 方位角（度，从北顺时针）→ 八方位 */
export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

export const clockText = (h: number) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function doyOf(key: SunDayKey): number {
  return key === 'today' ? dayOfYear() : SUN_DAYS[key].doy;
}

export function dayLabel(key: SunDayKey): string {
  return key === 'today' ? '今天' : SUN_DAYS[key].label;
}
