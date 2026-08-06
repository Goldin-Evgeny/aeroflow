export { D2Q9, CellType, equilibrium, isSolid } from './lattice.js';
export { D3Q19 } from './lattice3d.js';
export { latticeUnits, forceToNewtons, AIR_KINEMATIC_VISCOSITY, AIR_DENSITY } from './units.js';
export type { UnitMapping, UnitMappingInput } from './units.js';
export {
  collideCell,
  makeCollideContext,
  equilibrium3,
  D2Q9_SPEC,
  D3Q19_SPEC,
  piNeq,
  piNeqNorm,
  smagorinskyTauEff,
  viscosityFromTau,
} from './cpu/collide.js';
export type { CollideContext, LatticeSpec, Collision, Forcing } from './cpu/collide.js';
export { Solver2D } from './cpu/solver2d.js';
export type { Solver2DOptions, Macroscopics } from './cpu/solver2d.js';
export { Solver3D } from './cpu/solver3d.js';
export type { Solver3DOptions } from './cpu/solver3d.js';
export { EsotericPull3D } from './cpu/esoteric.js';
export type { EsotericPull3DOptions } from './cpu/esoteric.js';
export { GHIA_U, GHIA_V, interpProfile } from './fixtures/ghia.js';
export {
  fft,
  hannWindow,
  dominantFrequency,
  meanPeriodFromZeroCrossings,
  coefficient,
} from './analysis/spectrum.js';
export type { DominantFrequency } from './analysis/spectrum.js';
export { cylinderScene } from './scenes/cylinder2d.js';
export type { CylinderScene, CylinderSceneOptions } from './scenes/cylinder2d.js';
export { cavityScene2D } from './scenes/cavity2d.js';
export type { CavityScene, CavitySceneOptions } from './scenes/cavity2d.js';
export { cavityCenterlines, compareToGhia, formatGhiaComparison } from './validation/cavity.js';
export type {
  CavityCenterlines,
  CavityExtremum,
  CavityGhiaComparison,
  CavityRe,
} from './validation/cavity.js';
export {
  steadyStateResidual,
  SteadyStateDetector,
  STEADY_STATE_INTERVAL,
  STEADY_STATE_THRESHOLD,
  STEADY_STATE_CRITERION,
  PLATEAU_WINDOW,
  PLATEAU_MIN_IMPROVEMENT,
  PLATEAU_MIN_DECADES,
} from './stats/steadyState.js';
export type { ResidualSample, SteadyStateStop } from './stats/steadyState.js';
export { sphereMask } from './geometry/sphere.js';
export { icosphere } from './geometry/icosphere.js';
export type { TriangleMesh } from './geometry/icosphere.js';
export { ahmedBody, AHMED } from './geometry/ahmedBody.js';
export type { AhmedBodyOptions } from './geometry/ahmedBody.js';
export {
  normalizeDegrees,
  windFrameBasis,
  enuVectorToWindFrame,
  windFrameVectorToEnu,
  enuPointToWindFrame,
  windFramePointToEnu,
} from './geometry/windFrame.js';
export type { EnuVector, WindFrameVector, WindFrameBasis } from './geometry/windFrame.js';
export { ahmedScene, AHMED_EXPERIMENTAL_RE } from './scenes/ahmed3d.js';
export type { AhmedScene, AhmedSceneOptions } from './scenes/ahmed3d.js';
export { powerLawProfile, logLawProfile, ablProfileLattice, LATTICE_MACH_LIMIT } from './abl.js';
export type { AblSpec, AblLatticeProfile } from './abl.js';
export { hitRate, pearson } from './validation/score.js';
export {
  validateAijAttribution,
  formatAijCitation,
  AIJ_DATA_PAPER,
  AIJ_LES_GUIDELINE,
  AIJ_DISCLAIMER,
} from './validation/aijAttribution.js';
export type { AijAttribution, AijDatasetOfRecord } from './validation/aijAttribution.js';
export {
  validateAijCaseAData,
  interpolateInflowToLattice,
  sampleTrilinear,
  PointTimeAverager,
  ConvergingAverager,
  scoreCaseA,
} from './validation/aijCaseA.js';
export type {
  AijCaseAData,
  AijInflowPoint,
  AijMeasurementPoint,
  WindowedMeans,
  CaseAScore,
  CaseAScoreRow,
} from './validation/aijCaseA.js';
export {
  validateAijUrbanData,
  aijUrbanDirection,
  aijUrbanMeasuredInflow,
  aijUrbanProbesInWindFrame,
  scoreAijUrbanDirection,
} from './validation/aijUrban.js';
export type {
  AijUrbanCaseId,
  AijUrbanSpeedUnit,
  AijUrbanSpeedStatistic,
  AijUrbanSource,
  AijUrbanGeometrySource,
  AijUrbanRawProbe,
  AijUrbanRawDirection,
  AijUrbanRawFixture,
  AijUrbanProbe,
  AijUrbanDirection,
  AijUrbanData,
  AijUrbanWindFrameProbe,
  AijUrbanScoreRow,
  AijUrbanScore,
  AijUrbanInflowPoint,
} from './validation/aijUrban.js';
export { buildAijUrbanReport } from './validation/aijUrbanReport.js';
export type {
  AijUrbanRunEvidence,
  AijUrbanReportRow,
  AijUrbanReport,
} from './validation/aijUrbanReport.js';
export { caseAScene, AIJ_CASE_A } from './scenes/aijCaseA.js';
export type { CaseAScene, CaseASceneOptions } from './scenes/aijCaseA.js';
export {
  windAlignEnuPositions,
  bounds3,
  planUrbanDomain,
  assertUrbanDomainAcceptanceReady,
} from './scenes/urbanDomain.js';
export type {
  Bounds3,
  UrbanDomainPadding,
  UrbanDomainOptions,
  UrbanDomainCheck,
  UrbanDomainPlan,
} from './scenes/urbanDomain.js';
export {
  toUrbanLatticePositions,
  urbanPointToLattice,
  prepareUrbanScene,
  urbanBoundaryFlags,
  urbanScene,
} from './scenes/urbanScene.js';
export type {
  WindAlignedPoint,
  UrbanSceneOptions,
  UrbanSceneSetup,
  UrbanBoundaryResult,
  UrbanScene,
} from './scenes/urbanScene.js';
export { resolveFreeSlipPull, validateFreeSlip } from './cpu/freeslip.js';
export type { FreeSlipFaces, ResolvedPull } from './cpu/freeslip.js';
export { ForceHistory } from './stats/forceHistory.js';
export type { ForceHistoryOptions, ForceHistoryState, WindowStats } from './stats/forceHistory.js';
export { ConvergingVelocityAverager } from './stats/velocityTimeAverage.js';
export type {
  ResolvedVelocityStatistic,
  ConvergingVelocityStats,
  ConvergingVelocityAveragerState,
} from './stats/velocityTimeAverage.js';
export { sphereScene, SPHERE_CASES, SPHERE_FREESLIP_FACES } from './scenes/sphere3d.js';
export type {
  Sphere3DScene,
  Sphere3DCaseSpec,
  SphereSceneOptions,
  SphereCaseName,
  LateralBC,
} from './scenes/sphere3d.js';
export { stlSphereScene, calibrateMeshSphereRadius } from './scenes/stlSphere3d.js';
export type {
  StlSphereScene,
  StlSphereSceneOptions,
  SphereRadiusCalibration,
} from './scenes/stlSphere3d.js';
export { sphereDragCoefficient, sphereDragStats } from './analysis/sphereDrag.js';
export { sectionStats, upstreamStations } from './analysis/sectionProfile.js';
export type { SectionStats } from './analysis/sectionProfile.js';
export { fieldStats } from './analysis/fieldStats.js';
export type { FieldStats } from './analysis/fieldStats.js';
export { tauStats, tauLayersAt, ahmedTauRegions, TAU_PERCENTILES } from './analysis/tauStats.js';
export type { TauStats, TauRegion, TauLayer } from './analysis/tauStats.js';
export type { SphereDragStats, SphereDragStatsOptions } from './analysis/sphereDrag.js';
export {
  triBoxOverlap,
  voxelizeSurface,
  floodFillExterior,
  voxelizeSolid,
  VOXEL_SURFACE,
  VOXEL_EXTERIOR,
} from './voxel/voxelize.js';
export type { VoxelGrid } from './voxel/voxelize.js';
