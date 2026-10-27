// Exterior road, parking and pedestrian ingress layout shared by the renderer, the mobility core and tests.
// Heights follow the real surfaces: the parking slab tops out at .03, the driveway slopes from (12.5, .03)
// to (21, -.86), and the street asphalt sits at -.86. Every ramp lane keeps a point at the crest and at the
// foot so a vehicle never steps onto a slope before the mesh does.
(function(root){
  const layout = {
    lanes: [
      {id: 'visitor-in', points: [[-140, -.86, 22.5], [0, -.86, 22.5], [5.5, -.86, 21], [6, -.33647, 16]], next: ['in'], speed: 6},
      {id: 'street-east', points: [[-140, -.86, 22.5], [140, -.86, 22.5]], next: [], speed: 8},
      {id: 'street-west', points: [[140, -.86, 25.5], [-140, -.86, 25.5]], next: [], speed: 8},
      {id: 'out', points: [[10, .03, 10], [10, .03, 12.5], [10, -.33647, 16], [11, -.75529, 20], [12, -.86, 21], [15, -.86, 22.5], [100, -.86, 22.5]], next: ['return'], speed: 7},
      {id: 'return', points: [[100, -.86, 22.5], [110, -.86, 24], [100, -.86, 25.5], [12, -.86, 25.5]], next: ['turn-in'], speed: 7},
      {id: 'turn-in', points: [[12, -.86, 25.5], [8, -.86, 23.5], [6.57, -.86, 21], [6, -.75529, 20], [6, -.33647, 16]], next: ['in'], speed: 3, yieldTo: {box: [0, 20.6, 16, 24.4]}},
      {id: 'in', points: [[6, -.33647, 16], [6, .03, 12.5], [6, .03, 10]], next: [], speed: 3},
    ],
    conflicts: ['gate'],
    parking: [
      {id: 'car1', kind: 'car', position: [3, .03, 7], heading: 0, entryLane: 'in', exitLane: 'out'},
      {id: 'car2', kind: 'car', position: [13, .03, 7], heading: 0, entryLane: 'in', exitLane: 'out'},
      {id: 'motor1', kind: 'motorcycle', position: [14, .03, 10], heading: 0, entryLane: 'in', exitLane: 'out'},
      {id: 'motor2', kind: 'motorcycle', position: [15.5, .03, 10], heading: 0, entryLane: 'in', exitLane: 'out'},
    ],
    ingress: [[6, .03, 10], [7, .03, 7]],
  };
  if (typeof module === 'object' && module.exports) module.exports = layout;
  else root.officeEnvironmentLayout = layout;
})(typeof window === 'object' ? window : globalThis);
