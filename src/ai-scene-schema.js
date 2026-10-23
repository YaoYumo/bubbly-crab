// Structural contract; keep docs/ai-scene.schema.json identical (unit tested).
export const AI_SCENE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Previz AI scene blueprint v1",
  description:
    "Structural schema only. Runtime also validates dynamic asset parameters, permissions, stable IDs, spatial bounds, terrain, timings and source fingerprint.",
  type: "object",
  additionalProperties: false,
  properties: {
    schema: {
      const: "previz-ai-scene/1",
    },
    id: {
      type: "string",
      pattern: "^[a-zA-Z0-9_-]{1,100}$",
    },
    baseFingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 120,
    },
    mode: {
      enum: ["add", "edit", "replace"],
    },
    bounds: {
      type: "object",
      additionalProperties: false,
      properties: {
        center: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: {
            type: "number",
            minimum: -500,
            maximum: 500,
          },
        },
        size: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: {
            type: "number",
            minimum: 10,
            maximum: 600,
          },
        },
      },
      required: ["center", "size"],
    },
    seed: {
      type: "integer",
      minimum: 1,
      maximum: 2147483647,
    },
    terrain: {
      enum: ["preserve", "flat"],
    },
    durationSeconds: {
      type: "number",
      minimum: 0.2,
      maximum: 30,
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 180,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              op: {
                const: "add",
              },
              id: {
                type: "string",
                pattern: "^[a-zA-Z0-9_-]{1,100}$",
              },
              key: {
                type: "string",
              },
              name: {
                type: "string",
                maxLength: 120,
              },
              pos: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: -600,
                  maximum: 600,
                },
              },
              params: {
                type: "object",
              },
              rotationY: {
                type: "number",
                minimum: -32,
                maximum: 32,
              },
              scale: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: 0.05,
                  maximum: 10,
                },
              },
              fit: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: {
                  type: "number",
                  minimum: 1,
                  maximum: 100,
                },
              },
              placement: {
                enum: ["ground", "absolute"],
              },
            },
            required: ["op", "id", "key", "pos"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              op: {
                const: "transform",
              },
              objectId: {
                type: "string",
                pattern: "^[a-zA-Z0-9_-]{1,100}$",
              },
              pos: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: -600,
                  maximum: 600,
                },
              },
              rotationY: {
                type: "number",
                minimum: -32,
                maximum: 32,
              },
              scale: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: 0.05,
                  maximum: 10,
                },
              },
            },
            required: ["op", "objectId", "pos"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              op: {
                const: "remove",
              },
              objectId: {
                type: "string",
                pattern: "^[a-zA-Z0-9_-]{1,100}$",
              },
            },
            required: ["op", "objectId"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              op: {
                const: "road",
              },
              id: {
                type: "string",
                pattern: "^[a-zA-Z0-9_-]{1,100}$",
              },
              name: {
                type: "string",
                maxLength: 120,
              },
              points: {
                type: "array",
                minItems: 2,
                maxItems: 128,
                items: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "number",
                    minimum: -600,
                    maximum: 600,
                  },
                },
              },
              width: {
                type: "number",
                minimum: 2,
                maximum: 20,
              },
              roadType: {
                enum: ["asphalt", "concrete", "gravel", "garden"],
              },
            },
            required: ["op", "id", "points", "width", "roadType"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              op: {
                const: "rebuild",
              },
              objectId: {
                type: "string",
                pattern: "^[a-zA-Z0-9_-]{1,100}$",
              },
              pos: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: -600,
                  maximum: 600,
                },
              },
              rotationY: {
                type: "number",
                minimum: -32,
                maximum: 32,
              },
              scale: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: 0.05,
                  maximum: 10,
                },
              },
              params: {
                type: "object",
                minProperties: 1,
                description:
                  "Partial parameters must match the selected asset descriptor in the dynamic catalog; runtime validates them.",
              },
            },
            required: ["op", "objectId", "params"],
          },
        ],
      },
    },
    recipe: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              const: "template",
            },
            template: {
              enum: ["street", "plaza", "boulevard"],
            },
          },
          required: ["kind", "template"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              const: "town",
            },
            theme: {
              type: "string",
            },
            topology: {
              enum: ["grid", "axis", "radial", "spine_and_loop"],
            },
            density: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            vegetation: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["kind", "theme", "topology", "density", "vegetation"],
        },
      ],
    },
    previs: {
      type: "object",
      additionalProperties: false,
      properties: {
        subjectId: {
          type: "string",
          pattern: "^[a-zA-Z0-9_-]{1,100}$",
        },
        camera: {
          enum: ["none", "overview", "orbit", "follow", "push", "all"],
        },
        motion: {
          type: "object",
          additionalProperties: false,
          properties: {
            anim: {
              enum: [
                "idle",
                "walk",
                "run",
                "wave",
                "point",
                "talk",
                "look",
                "phone",
                "sit",
              ],
            },
            points: {
              type: "array",
              minItems: 2,
              maxItems: 32,
              items: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "number",
                  minimum: -600,
                  maximum: 600,
                },
              },
            },
          },
          required: ["anim", "points"],
        },
      },
      required: ["subjectId", "camera"],
    },
    relations: {
      type: "object",
      additionalProperties: false,
      properties: {
        version: {
          const: 1,
        },
        rules: {
          type: "array",
          minItems: 1,
          maxItems: 128,
          items: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    const: "offset",
                  },
                  subject: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  reference: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  delta: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: {
                      type: "number",
                      minimum: -500,
                      maximum: 500,
                    },
                  },
                  frame: {
                    enum: ["world", "local"],
                  },
                },
                required: ["type", "subject", "reference", "delta", "frame"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    const: "face",
                  },
                  subject: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  target: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                },
                required: ["type", "subject", "target"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    const: "distance",
                  },
                  subject: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  target: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  min: {
                    type: "number",
                    minimum: 0,
                    maximum: 1200,
                  },
                  max: {
                    type: "number",
                    minimum: 0,
                    maximum: 1200,
                  },
                },
                required: ["type", "subject", "target", "min", "max"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    const: "keep-out",
                  },
                  subject: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  obstacle: {
                    type: "string",
                    pattern: "^[a-zA-Z0-9_-]{1,100}$",
                  },
                  margin: {
                    type: "number",
                    minimum: 0,
                    maximum: 50,
                  },
                },
                required: ["type", "subject", "obstacle", "margin"],
              },
            ],
          },
        },
      },
      required: ["version", "rules"],
    },
  },
  required: [
    "schema",
    "id",
    "baseFingerprint",
    "name",
    "mode",
    "bounds",
    "seed",
    "terrain",
    "durationSeconds",
  ],
  oneOf: [
    {
      required: ["operations"],
      not: {
        required: ["recipe"],
      },
    },
    {
      required: ["recipe"],
      not: {
        required: ["operations"],
      },
    },
  ],
  allOf: [
    {
      if: {
        required: ["relations"],
      },
      then: {
        required: ["operations"],
        not: {
          required: ["recipe"],
        },
      },
    },
  ],
};
