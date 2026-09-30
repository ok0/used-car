import {
  findVehicles, findVehicleById, getAccidentsByCarId, getOptionsByCarId, getOwnerChangesByCarId, getUsageHistoryByCarId,
  getMarketPriceByCarId, getYearlyPricesByCarId, getStaleDays, staleCutoffIso, isStaleVehicle,
} from '../db/repository';
import { localBaselineFor } from '../scoring/rescore';
import { resolvePriceBaseline, MIN_LOCAL_PRICE_SAMPLES } from '../scoring/price';
import type { VehicleData, VehicleDetail, VehicleListItem, VehicleSortField } from '../types';

export function toListItem(v: VehicleData, staleCutoff: string | null): VehicleListItem {
  return {
    carId: v.carId, manufacturer: v.manufacturer, modelName: v.modelName, gradeName: v.gradeName, gradeDetail: v.gradeDetail,
    year: v.year, month: v.month, mileage: v.mileage, price: v.price,
    scoreGrade: v.scoreGrade, scoreTotal: v.scoreTotal,
    myDamageCount: v.myDamageCount, isInsurancePrivate: v.isInsurancePrivate, ownerChangeCount: v.ownerChangeCount,
    hasRentalHistory: v.hasRentalHistory, lastSeenAt: v.lastSeenAt, stale: isStaleVehicle(v, staleCutoff),
  };
}

export interface VehicleListResult { items: VehicleListItem[]; staleDays: number; }

/** list 명령과 같은 조건(findVehicles)으로 조건 일치 매물 전체를 반환 (표시 개수 제한 없음) */
export function listVehicles(q: { model?: string; minScore?: number; sort: VehicleSortField }, now: Date = new Date()): VehicleListResult {
  const staleDays = getStaleDays();
  const cutoff = staleCutoffIso(now, staleDays);
  const items = findVehicles({ model: q.model, minScore: q.minScore, sort: q.sort }).map((v) => toListItem(v, cutoff));
  return { items, staleDays };
}

/** detail 명령의 데이터 조회 부분. 없는 매물이면 null */
export function getVehicleDetail(carId: string, now: Date = new Date()): VehicleDetail | null {
  const vehicle = findVehicleById(carId);
  if (!vehicle) return null;
  const staleDays = getStaleDays();
  const yearlyPrices = getYearlyPricesByCarId(carId);
  const local = localBaselineFor(vehicle, now);
  const pb = resolvePriceBaseline({ price: vehicle.price, year: vehicle.year, yearlyPoints: yearlyPrices.length ? yearlyPrices : null, localBaseline: local }, now);
  return {
    vehicle,
    stale: isStaleVehicle(vehicle, staleCutoffIso(now, staleDays)),
    staleDays,
    priceBaseline: {
      source: pb.source, avgPrice: pb.avgPrice, sampleCount: pb.sampleCount,
      localSampleCount: local?.sampleCount ?? 0, minLocalSamples: MIN_LOCAL_PRICE_SAMPLES,
    },
    marketPrice: getMarketPriceByCarId(carId),
    yearlyPrices,
    accidents: getAccidentsByCarId(carId),
    ownerChanges: getOwnerChangesByCarId(carId),
    usageHistory: getUsageHistoryByCarId(carId),
    options: getOptionsByCarId(carId),
  };
}
