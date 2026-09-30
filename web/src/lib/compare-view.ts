// 비교 결과 → 화면 상태(톤) 파생 규칙 (순수 함수)
import type {
  AccidentComparison, CompareVerdict, InspectionComparison, MileageComparison, OptionComparison, OwnerComparison, RentalComparison,
} from '../../../src/types';
import type { Tone } from './labels';

export function priceTone(v: CompareVerdict): Tone {
  return v === 'cheap' ? 'good' : v === 'fair' ? 'neutral' : v === 'slightly_expensive' ? 'warn' : 'bad';
}
export function mileageTone(m: MileageComparison): Tone {
  if (m.judgement !== 'normal') return 'warn';
  if (m.peerRatio === null) return 'neutral';
  return m.peerRatio <= 0.8 ? 'good' : m.peerRatio >= 1.2 ? 'warn' : 'neutral';
}
export function accidentTone(a: AccidentComparison): Tone {
  switch (a.severity) {
    case 'none': return 'good';
    case 'minor': return 'neutral';
    case 'moderate': return 'warn';
    case 'severe': return 'bad';
    default: return 'unknown';
  }
}
export function inspectionTone(i: InspectionComparison): Tone {
  const x = i.input;
  if (x === null) return 'unknown';
  if (x.isClean === true) return 'good';
  if (x.hasWelding === true || x.hasReplacement === true || x.hasCorrosion === true) return 'warn';
  return 'unknown';
}
export function ownerTone(o: OwnerComparison): Tone {
  if (o.inputCount === null) return 'unknown';
  if (o.inputCount === 0) return 'good';
  if (o.inputCount >= 4) return 'bad';
  if (o.inputCount >= 3) return 'warn';
  return 'neutral';
}
export function rentalTone(r: RentalComparison): Tone {
  return r.inputHasRental === null ? 'unknown' : r.inputHasRental ? 'bad' : 'good';
}
export function optionTone(op: OptionComparison, specAdjustment: number): Tone {
  if (op.specDiffPercent === null) return 'unknown';
  return specAdjustment > 0 ? 'good' : specAdjustment < 0 ? 'warn' : 'neutral';
}
