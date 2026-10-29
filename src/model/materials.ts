import type {Material, MaterialId} from './types';

export const MATERIALS: Record<MaterialId, Material> = {
  wood: {name: '橡木地板', price: 320, swatch: '#D8B88A'},
  walnut: {name: '胡桃木地板', price: 380, swatch: '#9B7250'},
  tile800: {name: '800 地砖', price: 220, swatch: '#EBE6DC'},
  tile600: {name: '600 地砖', price: 160, swatch: '#DFE3E1'},
  marble: {name: '大理石', price: 650, swatch: '#F1EEE8'},
  antislip: {name: '300 防滑砖', price: 140, swatch: '#D3D8D4'},
  terrazzo: {name: '水磨石', price: 280, swatch: '#E6DFD3'},
  carpet: {name: '满铺地毯', price: 200, swatch: '#C9C3D3'},
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

/** 损耗率，预算里统一加 5% */
export const WASTE_RATE = 0.05;
