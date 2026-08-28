export type DroComponents = {
  deliveryCube?: number | null;
  pickupCube?: number | null;
  combinationCube?: number | null;
  deliveryPackages?: number | null;
  pickupPackages?: number | null;
  combinationPackages?: number | null;
  deliveryStops?: number | null;
  pickupStops?: number | null;
  combinationStops?: number | null;
  vehicleCapacity?: number | null;
};

function number(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function calculateDroMetrics(input: DroComponents) {
  const deliveryCube = number(input.deliveryCube);
  const pickupCube = number(input.pickupCube);
  const combinationCube = number(input.combinationCube);
  const deliveryPackages = number(input.deliveryPackages);
  const pickupPackages = number(input.pickupPackages);
  const combinationPackages = number(input.combinationPackages);
  const deliveryStops = number(input.deliveryStops);
  const pickupStops = number(input.pickupStops);
  const combinationStops = number(input.combinationStops);
  const vehicleCapacity = number(input.vehicleCapacity);
  const usedCapacity = deliveryCube + pickupCube + combinationCube;

  return {
    deliveryCube,
    pickupCube,
    combinationCube,
    usedCapacity,
    vehicleCapacity,
    deliveryPackages,
    pickupPackages,
    combinationPackages,
    totalPackages: deliveryPackages + pickupPackages + combinationPackages,
    deliveryStops,
    pickupStops,
    combinationStops,
    totalStops: deliveryStops + pickupStops + combinationStops,
    warning: vehicleCapacity === 600 && usedCapacity > 300,
  };
}
