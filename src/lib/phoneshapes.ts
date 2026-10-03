/**
 * The back of each iPhone model, for drawing it small: measured from Apple's own images
 * (apple.com/iphone/compare, support.apple.com/108044) as fractions of the phone's body.
 * x and diameters are fractions of its width, y of its height. A model not listed is drawn
 * as a plain outline.
 */

export interface PhoneShape {
  /** Height over width, and the corner radius as a fraction of the width. */
  aspect: number;
  radius: number;
  color: string;
  /** The camera bump: a rounded square, a pill, a full-width plateau. */
  module?: { x: number; y: number; w: number; h: number; radius: number; color: string };
  /** Lens centres and diameters. */
  lenses: Array<[number, number, number]>;
  extras?: Array<["flash" | "lidar", number, number, number]>;
}

const SHAPES: Record<string, PhoneShape> = {
  "iPhone 18 Pro": {"aspect": 2.056, "radius": 0.194, "color": "#d5d5d5", "module": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.285, "radius": 0, "color": "#d8d8d6"}, "lenses": [[0.204, 0.096, 0.196], [0.452, 0.16, 0.195], [0.204, 0.224, 0.196]], "extras": [["flash", 0.807, 0.093, 0.09], ["lidar", 0.8, 0.222, 0.093]]},
  "iPhone 18 Pro Max": {"aspect": 2.074, "radius": 0.179, "color": "#d6d6d6", "module": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.272, "radius": 0, "color": "#d2d2d0"}, "lenses": [[0.188, 0.087, 0.181], [0.418, 0.146, 0.18], [0.188, 0.204, 0.181]], "extras": [["flash", 0.81, 0.085, 0.083], ["lidar", 0.8, 0.204, 0.086]]},
  "iPhone 17 Pro": {"aspect": 2.073, "radius": 0.183, "color": "#e7e7e5", "module": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.288, "radius": 0, "color": "#c8c8c6"}, "lenses": [[0.201, 0.094, 0.191], [0.448, 0.158, 0.19], [0.201, 0.222, 0.191]], "extras": [["flash", 0.807, 0.093, 0.09], ["lidar", 0.8, 0.222, 0.093]]},
  "iPhone 17 Pro Max": {"aspect": 2.077, "radius": 0.18, "color": "#e8e8e6", "module": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.272, "radius": 0, "color": "#c4c4c2"}, "lenses": [[0.189, 0.087, 0.177], [0.418, 0.146, 0.176], [0.188, 0.205, 0.176]], "extras": [["flash", 0.81, 0.085, 0.083], ["lidar", 0.8, 0.204, 0.086]]},
  "iPhone 17": {"aspect": 2.07, "radius": 0.185, "color": "#f7f6f4", "module": {"x": 0.08, "y": 0.022, "w": 0.23, "h": 0.258, "radius": 0.115, "color": "#cecece"}, "lenses": [[0.194, 0.091, 0.191], [0.193, 0.209, 0.19]], "extras": [["flash", 0.41, 0.118, 0.07]]},
  "iPhone 17e": {"aspect": 2.028, "radius": 0.173, "color": "#f6f6f4", "lenses": [[0.189, 0.091, 0.176]], "extras": [["flash", 0.41, 0.093, 0.065]]},
  "iPhone Air": {"aspect": 2.073, "radius": 0.187, "color": "#f1f3f2", "module": {"x": 0.05, "y": 0.04, "w": 0.9, "h": 0.125, "radius": 0.062, "color": "#edefee"}, "lenses": [[0.223, 0.104, 0.172]]},
  "iPhone 16 Pro": {"aspect": 2.076, "radius": 0.195, "color": "#e7e7e5", "module": {"x": 0.05, "y": 0.02, "w": 0.55, "h": 0.268, "radius": 0.12, "color": "#e6e6e6"}, "lenses": [[0.204, 0.093, 0.191], [0.453, 0.157, 0.19], [0.204, 0.221, 0.19]], "extras": [["flash", 0.45, 0.062, 0.09], ["lidar", 0.452, 0.247, 0.089]]},
  "iPhone 16 Pro Max": {"aspect": 2.084, "radius": 0.169, "color": "#e7e7e5", "module": {"x": 0.045, "y": 0.019, "w": 0.51, "h": 0.248, "radius": 0.11, "color": "#e6e6e6"}, "lenses": [[0.186, 0.085, 0.176], [0.415, 0.144, 0.175], [0.186, 0.202, 0.175]], "extras": [["flash", 0.415, 0.056, 0.083], ["lidar", 0.414, 0.227, 0.081]]},
  "iPhone 16 Plus": {"aspect": 2.047, "radius": 0.17, "color": "#f7f6f4", "module": {"x": 0.075, "y": 0.021, "w": 0.21, "h": 0.237, "radius": 0.105, "color": "#cfcfcf"}, "lenses": [[0.179, 0.084, 0.175], [0.179, 0.195, 0.175]], "extras": [["flash", 0.38, 0.11, 0.065]]},
  "iPhone 16": {"aspect": 2.04, "radius": 0.183, "color": "#f7f6f4", "module": {"x": 0.08, "y": 0.022, "w": 0.23, "h": 0.258, "radius": 0.115, "color": "#d1d1d0"}, "lenses": [[0.193, 0.091, 0.189], [0.193, 0.211, 0.189]], "extras": [["flash", 0.41, 0.12, 0.07]]},
  "iPhone 16e": {"aspect": 2.028, "radius": 0.173, "color": "#f6f6f4", "lenses": [[0.19, 0.091, 0.176]], "extras": [["flash", 0.41, 0.093, 0.065]]},
  "iPhone 15 Pro": {"aspect": 2.053, "radius": 0.173, "color": "#e8e5de", "module": {"x": 0.05, "y": 0.021, "w": 0.56, "h": 0.272, "radius": 0.12, "color": "#d8d6d0"}, "lenses": [[0.204, 0.097, 0.194], [0.456, 0.162, 0.194], [0.204, 0.228, 0.193]], "extras": [["flash", 0.45, 0.066, 0.09], ["lidar", 0.455, 0.254, 0.09]]},
  "iPhone 15 Pro Max": {"aspect": 2.059, "radius": 0.168, "color": "#e8e6df", "module": {"x": 0.045, "y": 0.019, "w": 0.52, "h": 0.25, "radius": 0.11, "color": "#d8d6d0"}, "lenses": [[0.189, 0.088, 0.178], [0.42, 0.148, 0.177], [0.189, 0.208, 0.178]], "extras": [["flash", 0.42, 0.058, 0.083], ["lidar", 0.419, 0.232, 0.083]]},
  "iPhone 15 Plus": {"aspect": 2.047, "radius": 0.177, "color": "#f4f8f9", "module": {"x": 0.04, "y": 0.018, "w": 0.39, "h": 0.2, "radius": 0.1, "color": "#cfd9dd"}, "lenses": [[0.167, 0.079, 0.16], [0.331, 0.159, 0.16]], "extras": [["flash", 0.33, 0.072, 0.06]]},
  "iPhone 15": {"aspect": 2.038, "radius": 0.18, "color": "#f5f9fa", "module": {"x": 0.04, "y": 0.02, "w": 0.43, "h": 0.215, "radius": 0.11, "color": "#cfd9dd"}, "lenses": [[0.182, 0.086, 0.174], [0.359, 0.173, 0.174]], "extras": [["flash", 0.36, 0.075, 0.065]]},
  "iPhone 14 Pro": {"aspect": 2.041, "radius": 0.183, "color": "#f0f1f3", "module": {"x": 0.05, "y": 0.02, "w": 0.55, "h": 0.272, "radius": 0.12, "color": "#dfe1e1"}, "lenses": [[0.202, 0.096, 0.19], [0.45, 0.161, 0.19], [0.2, 0.228, 0.19]], "extras": [["flash", 0.42, 0.062, 0.09], ["lidar", 0.45, 0.253, 0.088]]},
  "iPhone 14 Pro Max": {"aspect": 2.053, "radius": 0.168, "color": "#f0f1f3", "module": {"x": 0.045, "y": 0.019, "w": 0.5, "h": 0.248, "radius": 0.11, "color": "#e0e1e2"}, "lenses": [[0.186, 0.088, 0.176], [0.415, 0.148, 0.176], [0.185, 0.21, 0.176]], "extras": [["flash", 0.39, 0.056, 0.083], ["lidar", 0.415, 0.233, 0.081]]},
  "iPhone 14 Plus": {"aspect": 2.035, "radius": 0.167, "color": "#f9f4f0", "module": {"x": 0.035, "y": 0.018, "w": 0.39, "h": 0.2, "radius": 0.1, "color": "#efebe8"}, "lenses": [[0.164, 0.078, 0.16], [0.326, 0.158, 0.158]], "extras": [["flash", 0.33, 0.072, 0.06]]},
  "iPhone 14": {"aspect": 2.025, "radius": 0.17, "color": "#f9f4f0", "module": {"x": 0.035, "y": 0.02, "w": 0.43, "h": 0.215, "radius": 0.11, "color": "#f0ebe8"}, "lenses": [[0.171, 0.081, 0.173], [0.346, 0.168, 0.172]], "extras": [["flash", 0.34, 0.075, 0.065]]},
  "iPhone SE (3rd generation)": {"aspect": 2.03, "radius": 0.165, "color": "#f7f2ed", "lenses": [[0.154, 0.071, 0.113]], "extras": [["flash", 0.335, 0.075, 0.06]]},
  "iPhone SE (2nd generation)": {"aspect": 2.078, "radius": 0.18, "color": "#f1f1f1", "lenses": [[0.156, 0.071, 0.115]], "extras": [["flash", 0.335, 0.075, 0.06]]},
  "iPhone 13 Pro": {"aspect": 2.028, "radius": 0.171, "color": "#ebece7", "module": {"x": 0.04, "y": 0.02, "w": 0.54, "h": 0.27, "radius": 0.12, "color": "#e3e4de"}, "lenses": [[0.182, 0.093, 0.189], [0.42, 0.152, 0.183], [0.185, 0.214, 0.2]], "extras": [["flash", 0.39, 0.06, 0.09], ["lidar", 0.421, 0.241, 0.081]]},
  "iPhone 13 Pro Max": {"aspect": 2.038, "radius": 0.158, "color": "#ebece7", "module": {"x": 0.035, "y": 0.018, "w": 0.5, "h": 0.245, "radius": 0.11, "color": "#e3e3de"}, "lenses": [[0.167, 0.084, 0.174], [0.385, 0.138, 0.167], [0.17, 0.195, 0.184]], "extras": [["flash", 0.36, 0.055, 0.083], ["lidar", 0.386, 0.219, 0.075]]},
  "iPhone 13": {"aspect": 2.029, "radius": 0.171, "color": "#f9f4f0", "module": {"x": 0.04, "y": 0.018, "w": 0.42, "h": 0.21, "radius": 0.11, "color": "#f5f0ed"}, "lenses": [[0.171, 0.081, 0.162], [0.341, 0.164, 0.162]], "extras": [["flash", 0.35, 0.07, 0.06]]},
  "iPhone 13 mini": {"aspect": 2.03, "radius": 0.166, "color": "#faf5f1", "module": {"x": 0.04, "y": 0.018, "w": 0.46, "h": 0.235, "radius": 0.12, "color": "#f5f0ec"}, "lenses": [[0.173, 0.08, 0.18], [0.362, 0.173, 0.18]], "extras": [["flash", 0.37, 0.07, 0.065]]},
  "iPhone 12 Pro": {"aspect": 2.036, "radius": 0.172, "color": "#e8e9e4", "module": {"x": 0.04, "y": 0.018, "w": 0.44, "h": 0.225, "radius": 0.11, "color": "#e0e0da"}, "lenses": [[0.166, 0.082, 0.154], [0.358, 0.134, 0.139], [0.174, 0.186, 0.166]], "extras": [["flash", 0.35, 0.055, 0.06], ["lidar", 0.359, 0.207, 0.079]]},
  "iPhone 12 Pro Max": {"aspect": 2.059, "radius": 0.167, "color": "#e9eae5", "module": {"x": 0.035, "y": 0.018, "w": 0.43, "h": 0.215, "radius": 0.11, "color": "#e0e0db"}, "lenses": [[0.165, 0.083, 0.159], [0.365, 0.136, 0.145], [0.173, 0.19, 0.172]], "extras": [["flash", 0.36, 0.055, 0.06], ["lidar", 0.365, 0.211, 0.075]]},
  "iPhone 12": {"aspect": 2.022, "radius": 0.172, "color": "#faf5f2", "module": {"x": 0.04, "y": 0.018, "w": 0.41, "h": 0.2, "radius": 0.11, "color": "#f6f3f1"}, "lenses": [[0.181, 0.086, 0.139], [0.181, 0.184, 0.14]], "extras": [["flash", 0.355, 0.14, 0.07]]},
  "iPhone 12 mini": {"aspect": 2.03, "radius": 0.167, "color": "#f9f5f2", "module": {"x": 0.04, "y": 0.018, "w": 0.44, "h": 0.225, "radius": 0.12, "color": "#f6f2f1"}, "lenses": [[0.17, 0.08, 0.155], [0.169, 0.188, 0.155]], "extras": [["flash", 0.33, 0.14, 0.07]]},
  "iPhone 11 Pro": {"aspect": 2.0, "radius": 0.162, "color": "#e0e0d8", "module": {"x": 0.035, "y": 0.018, "w": 0.43, "h": 0.22, "radius": 0.11, "color": "#e3e1db"}, "lenses": [[0.164, 0.084, 0.149], [0.35, 0.134, 0.136], [0.164, 0.187, 0.155]], "extras": [["flash", 0.32, 0.05, 0.06]]},
  "iPhone 11 Pro Max": {"aspect": 2.023, "radius": 0.148, "color": "#ddddd5", "module": {"x": 0.03, "y": 0.018, "w": 0.39, "h": 0.2, "radius": 0.1, "color": "#e2e1db"}, "lenses": [[0.15, 0.076, 0.137], [0.321, 0.122, 0.125], [0.15, 0.17, 0.142]], "extras": [["flash", 0.3, 0.045, 0.055]]},
  "iPhone 11": {"aspect": 1.974, "radius": 0.163, "color": "#fbf8f1", "module": {"x": 0.035, "y": 0.018, "w": 0.4, "h": 0.2, "radius": 0.11, "color": "#faf6f1"}, "lenses": [[0.166, 0.081, 0.133], [0.166, 0.176, 0.133]], "extras": [["flash", 0.33, 0.13, 0.065]]},
  "iPhone XS": {"aspect": 2.017, "radius": 0.179, "color": "#e3e3e1", "module": {"x": 0.095, "y": 0.054, "w": 0.137, "h": 0.16, "radius": 0.069, "color": "#070707"}, "lenses": [[0.163, 0.088, 0.08], [0.163, 0.178, 0.08]], "extras": [["flash", 0.163, 0.133, 0.05]]},
  "iPhone XS Max": {"aspect": 2.023, "radius": 0.148, "color": "#e3e3e1", "module": {"x": 0.085, "y": 0.045, "w": 0.124, "h": 0.146, "radius": 0.062, "color": "#070707"}, "lenses": [[0.147, 0.078, 0.072], [0.147, 0.158, 0.072]], "extras": [["flash", 0.147, 0.118, 0.045]]},
  "iPhone X": {"aspect": 2.006, "radius": 0.159, "color": "#e3e3e1", "module": {"x": 0.095, "y": 0.048, "w": 0.137, "h": 0.157, "radius": 0.069, "color": "#0c0c0c"}, "lenses": [[0.163, 0.085, 0.08], [0.163, 0.17, 0.08]], "extras": [["flash", 0.163, 0.126, 0.05]]},
  "iPhone XR": {"aspect": 1.991, "radius": 0.17, "color": "#47ade9", "lenses": [[0.16, 0.082, 0.128]], "extras": [["flash", 0.16, 0.17, 0.05]]},
  "iPhone 8 Plus": {"aspect": 2.017, "radius": 0.148, "color": "#f4e6dc", "module": {"x": 0.09, "y": 0.035, "w": 0.23, "h": 0.06, "radius": 0.06, "color": "#0c0c0c"}, "lenses": [[0.135, 0.065, 0.06], [0.275, 0.065, 0.06]]},
  "iPhone 8": {"aspect": 2.042, "radius": 0.163, "color": "#f7e6dc", "lenses": [[0.153, 0.071, 0.112]]},
  "iPhone 7 Plus": {"aspect": 2.044, "radius": 0.15, "color": "#edc2bc", "module": {"x": 0.09, "y": 0.035, "w": 0.23, "h": 0.06, "radius": 0.06, "color": "#010101"}, "lenses": [[0.135, 0.065, 0.06], [0.275, 0.065, 0.06]]},
  "iPhone 7": {"aspect": 2.048, "radius": 0.16, "color": "#edc2bc", "lenses": [[0.153, 0.072, 0.112]], "extras": [["flash", 0.33, 0.072, 0.06]]},
  "iPhone 6s": {"aspect": 2.09, "radius": 0.156, "color": "#e4b9b3", "lenses": [[0.19, 0.046, 0.083]], "extras": [["flash", 0.33, 0.046, 0.05]]},
  "iPhone 6": {"aspect": 2.09, "radius": 0.156, "color": "#e4b9b3", "lenses": [[0.19, 0.046, 0.083]], "extras": [["flash", 0.33, 0.046, 0.05]]},
  "iPhone 6s Plus": {"aspect": 2.06, "radius": 0.139, "color": "#e4b9b3", "lenses": [[0.185, 0.044, 0.077]], "extras": [["flash", 0.33, 0.044, 0.045]]},
  "iPhone 6 Plus": {"aspect": 2.06, "radius": 0.139, "color": "#e4b9b3", "lenses": [[0.185, 0.044, 0.077]], "extras": [["flash", 0.33, 0.044, 0.045]]},
  "iPhone 5s": {"aspect": 2.14, "radius": 0.163, "color": "#c7b6a2", "lenses": [[0.157, 0.062, 0.097]], "extras": [["flash", 0.31, 0.062, 0.05]]},
  "iPhone SE (1st generation)": {"aspect": 2.14, "radius": 0.163, "color": "#c7b6a2", "lenses": [[0.157, 0.062, 0.097]], "extras": [["flash", 0.31, 0.062, 0.05]]},
  "iPhone 5": {"aspect": 2.14, "radius": 0.163, "color": "#c7b6a2", "lenses": [[0.157, 0.062, 0.097]], "extras": [["flash", 0.31, 0.062, 0.05]]},
  "iPhone 5c": {"aspect": 2.16, "radius": 0.173, "color": "#96e264", "lenses": [[0.165, 0.066, 0.099]]},
  "iPhone 4s": {"aspect": 1.98, "radius": 0.08, "color": "#ededed", "lenses": [[0.143, 0.078, 0.1]], "extras": [["flash", 0.25, 0.078, 0.05]]},
  "iPhone 4": {"aspect": 1.98, "radius": 0.08, "color": "#ededed", "lenses": [[0.143, 0.078, 0.1]], "extras": [["flash", 0.25, 0.078, 0.05]]},
  "iPhone 3GS": {"aspect": 1.87, "radius": 0.17, "color": "#e4e4e4", "lenses": [[0.169, 0.083, 0.069]]},
};

/** A phone's shape by its marketing name ("iPhone 16 Pro"); a regional variant looks like its model. */
export function phoneShape(name: string | undefined): PhoneShape | undefined {
  if (!name) return undefined;
  const model = name.replace(/ \((US|China)\)$/, "");
  return Object.hasOwn(SHAPES, model) ? SHAPES[model] : undefined;
}
