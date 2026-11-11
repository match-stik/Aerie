// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The 2026 palette set: twenty-six themes, each with a night and a day side,
 * chosen on a design canvas. Generated from docs/themes/aerie-themes.json;
 * edit that file and regenerate rather than retyping hex codes here. They sit
 * BESIDE the seventeen single-accent themes on their own page, so nothing
 * already chosen moves.
 *
 * Every pair is measured apart (no two look alike) and every bubble pair is
 * precomputed so white text reads at night and black text by day. Re-measure
 * after any edit; the doc carries the fit algorithm.
 */
export interface NightPalette {
  primary: string; secondary: string; glow: string; spark: string;
  velvet?: string; deep: string; surface: string; text: string; muted: string;
  ink: string; number2: string; bubbleUser: [string, string];
}
export interface DayPalette {
  primary: string; secondary: string; glow: string; spark: string;
  wash: string; page: string; surface: string; text: string; muted: string;
  ink: string; bubbleUser: [string, string];
  /** Soft paper, about 8% dimmer than page. The default by day. */
  soft: { page: string; surface: string; muted: string; glow: string };
}
export interface Palette {
  id: string; name: string; band: string;
  night: NightPalette; day: DayPalette;
}

export const PALETTES: Palette[] = [
  {
    "id": "garnet",
    "name": "Garnet",
    "band": "Red",
    "night": {
      "primary": "#9B1B30",
      "secondary": "#6E1423",
      "glow": "#C9CCD3",
      "spark": "#7F91B2",
      "velvet": "#3A0A14",
      "deep": "#0E090A",
      "surface": "#1B1214",
      "text": "#EEE4E2",
      "muted": "#BFB2B0",
      "ink": "#FFF4F2",
      "number2": "#7F91B2",
      "bubbleUser": [
        "#9B1B30",
        "#6E1423"
      ]
    },
    "day": {
      "primary": "#9B1B30",
      "secondary": "#6E1423",
      "glow": "#5B6B8C",
      "spark": "#7F91B2",
      "wash": "#EEE2DE",
      "page": "#F7F1F0",
      "surface": "#FFFBFA",
      "text": "#2A1418",
      "muted": "#6E5A5C",
      "ink": "#FFF8F6",
      "bubbleUser": [
        "#CBAAAE",
        "#A6ABBC"
      ],
      "soft": {
        "page": "#E7DFDF",
        "surface": "#F4EFEF",
        "muted": "#4F3B3D",
        "glow": "#4A4D63"
      }
    }
  },
  {
    "id": "fire",
    "name": "Fire",
    "band": "Red",
    "night": {
      "primary": "#B3263A",
      "secondary": "#A4471F",
      "glow": "#D08A4E",
      "spark": "#E6D6BE",
      "velvet": "#4A2A1C",
      "deep": "#120D0B",
      "surface": "#1F1815",
      "text": "#EEDFCB",
      "muted": "#BFA993",
      "ink": "#FBF1E6",
      "number2": "#E0715A",
      "bubbleUser": [
        "#B3263A",
        "#A4471F"
      ]
    },
    "day": {
      "primary": "#A3202F",
      "secondary": "#9A3F17",
      "glow": "#A65A1E",
      "spark": "#6B4A35",
      "wash": "#EADCC8",
      "page": "#F8F1E8",
      "surface": "#FFFAF3",
      "text": "#2B1A12",
      "muted": "#6F5A4A",
      "ink": "#FFF8F0",
      "bubbleUser": [
        "#CFA38C",
        "#CDA27F"
      ],
      "soft": {
        "page": "#E8E0D7",
        "surface": "#F4EFE8",
        "muted": "#503D31",
        "glow": "#7B441A"
      }
    }
  },
  {
    "id": "oxbloodnavy",
    "name": "Oxblood & Navy",
    "band": "Red",
    "night": {
      "primary": "#7D2A2F",
      "secondary": "#34405A",
      "glow": "#B7C3D9",
      "spark": "#B4474E",
      "velvet": "#422741",
      "deep": "#0F0C0E",
      "surface": "#1C181B",
      "text": "#ECE1D7",
      "muted": "#C1A78E",
      "ink": "#FBF3EA",
      "number2": "#7F91B2",
      "bubbleUser": [
        "#7D2A2F",
        "#34405A"
      ]
    },
    "day": {
      "primary": "#7D2A2F",
      "secondary": "#34405A",
      "glow": "#4F607F",
      "spark": "#B4474E",
      "wash": "#E5E2EA",
      "page": "#F3EFEC",
      "surface": "#FFFCFA",
      "text": "#231A22",
      "muted": "#665A63",
      "ink": "#FFF8F6",
      "bubbleUser": [
        "#C9A8A8",
        "#AEB0B7"
      ],
      "soft": {
        "page": "#E2DEDC",
        "surface": "#F4F1EF",
        "muted": "#483D46",
        "glow": "#40485E"
      }
    }
  },
  {
    "id": "dragon",
    "name": "Dragon Ink",
    "band": "Red",
    "night": {
      "primary": "#C4746E",
      "secondary": "#A292A3",
      "glow": "#9FB5C2",
      "spark": "#B6927B",
      "velvet": "#658594",
      "deep": "#0D0C0C",
      "surface": "#181616",
      "text": "#C5C9C5",
      "muted": "#B5B5AC",
      "ink": "#0D0C0C",
      "number2": "#C4746E",
      "bubbleUser": [
        "#9F5F5A",
        "#786C79"
      ]
    },
    "day": {
      "primary": "#B5524B",
      "secondary": "#766B90",
      "glow": "#4D699B",
      "spark": "#836F4A",
      "wash": "#E3E1E8",
      "page": "#ECEDEE",
      "surface": "#FBFAF7",
      "text": "#43436C",
      "muted": "#6E6B61",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#A0AEC6",
        "#D2A3A0"
      ],
      "soft": {
        "page": "#DEDFE4",
        "surface": "#F2F1F0",
        "muted": "#5B5966",
        "glow": "#4A5C8B"
      }
    }
  },
  {
    "id": "hearth",
    "name": "Hearth",
    "band": "Red",
    "night": {
      "primary": "#AF3A03",
      "secondary": "#CC241D",
      "glow": "#E07040",
      "spark": "#93A9B9",
      "velvet": "#9D0006",
      "deep": "#110C0A",
      "surface": "#1E1714",
      "text": "#EBDBB2",
      "muted": "#BDAE93",
      "ink": "#FBF1C7",
      "number2": "#AF3A03",
      "bubbleUser": [
        "#AF3A03",
        "#CC241D"
      ]
    },
    "day": {
      "primary": "#AF3A03",
      "secondary": "#9D0006",
      "glow": "#B8461B",
      "spark": "#4F6B7D",
      "wash": "#F0DCCD",
      "page": "#F7EEDD",
      "surface": "#FFF9EE",
      "text": "#3C3836",
      "muted": "#665C54",
      "ink": "#FFF8EC",
      "bubbleUser": [
        "#D79F7D",
        "#D99D80"
      ],
      "soft": {
        "page": "#E8DFD0",
        "surface": "#F5EFE5",
        "muted": "#534C46",
        "glow": "#8D4124"
      }
    }
  },
  {
    "id": "terafox",
    "name": "Terafox",
    "band": "Red",
    "night": {
      "primary": "#FF8349",
      "secondary": "#5A93AA",
      "glow": "#A1CDD8",
      "spark": "#E85C51",
      "velvet": "#2D4F56",
      "deep": "#0B1517",
      "surface": "#152528",
      "text": "#E6EAEA",
      "muted": "#A9BCBC",
      "ink": "#0B1517",
      "number2": "#FF8349",
      "bubbleUser": [
        "#A75B37",
        "#4A7A8D"
      ]
    },
    "day": {
      "primary": "#C54E29",
      "secondary": "#2F6F8A",
      "glow": "#287980",
      "spark": "#A5222F",
      "wash": "#D9E8E7",
      "page": "#EEF3F2",
      "surface": "#FAFCFC",
      "text": "#1D3337",
      "muted": "#4E6A6E",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#D99D89",
        "#92B4C0"
      ],
      "soft": {
        "page": "#DDE4E3",
        "surface": "#EFF2F2",
        "muted": "#385155",
        "glow": "#246066"
      }
    }
  },
  {
    "id": "ember",
    "name": "Ember",
    "band": "Orange",
    "night": {
      "primary": "#FF9E3B",
      "secondary": "#DCA561",
      "glow": "#7FB4CA",
      "spark": "#C34043",
      "velvet": null,
      "deep": "#0D0C0C",
      "surface": "#181616",
      "text": "#DCD7BA",
      "muted": "#B7B19A",
      "ink": "#0D0C0C",
      "number2": "#FF9E3B",
      "bubbleUser": [
        "#9E6428",
        "#916E42"
      ]
    },
    "day": {
      "primary": "#B35A00",
      "secondary": "#8A5A2B",
      "glow": "#427284",
      "spark": "#B33A2B",
      "wash": "#EDE3D4",
      "page": "#F5EFE6",
      "surface": "#FFFBF5",
      "text": "#3B2E26",
      "muted": "#6B6359",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#D3A26E",
        "#C2A78C"
      ],
      "soft": {
        "page": "#E6E0D7",
        "surface": "#F5F1EB",
        "muted": "#554B42",
        "glow": "#405A63"
      }
    }
  },
  {
    "id": "melange",
    "name": "Melange",
    "band": "Orange",
    "night": {
      "primary": "#E49B5D",
      "secondary": "#7F91B2",
      "glow": "#A3A9CE",
      "spark": "#7B9695",
      "velvet": "#7D2A2F",
      "deep": "#15120F",
      "surface": "#292522",
      "text": "#ECE1D7",
      "muted": "#C1A78E",
      "ink": "#15120F",
      "number2": "#E49B5D",
      "bubbleUser": [
        "#996A41",
        "#66738B"
      ]
    },
    "day": {
      "primary": "#8F6100",
      "secondary": "#465AA4",
      "glow": "#54699F",
      "spark": "#3D6568",
      "wash": "#E0E2E8",
      "page": "#F1EDEA",
      "surface": "#FAF7F4",
      "text": "#54433A",
      "muted": "#7D6658",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#C2AA7A",
        "#A6ACCB"
      ],
      "soft": {
        "page": "#E4DFDC",
        "surface": "#F2EEEB",
        "muted": "#6B564A",
        "glow": "#545C7C"
      }
    }
  },
  {
    "id": "espresso",
    "name": "Espresso",
    "band": "Brown",
    "night": {
      "primary": "#8E5F3D",
      "secondary": "#6B4231",
      "glow": "#E8D9C8",
      "spark": "#A8503A",
      "velvet": "#2E1C14",
      "deep": "#0F0B09",
      "surface": "#1C1512",
      "text": "#EDE2D6",
      "muted": "#BFAE9C",
      "ink": "#FBF4EC",
      "number2": "#8E5F3D",
      "bubbleUser": [
        "#8E5F3D",
        "#6B4231"
      ]
    },
    "day": {
      "primary": "#8E5F3D",
      "secondary": "#6B4231",
      "glow": "#7A5A44",
      "spark": "#A8503A",
      "wash": "#EBDDD0",
      "page": "#F3ECE5",
      "surface": "#FFFBF7",
      "text": "#2E1C14",
      "muted": "#6F5A4C",
      "ink": "#FFF8F2",
      "bubbleUser": [
        "#BDA89D",
        "#C3A894"
      ],
      "soft": {
        "page": "#E3DBD4",
        "surface": "#F5F0EC",
        "muted": "#523E33",
        "glow": "#5F4433"
      }
    }
  },
  {
    "id": "copper",
    "name": "Copper",
    "band": "Brown",
    "night": {
      "primary": "#9E5530",
      "secondary": "#7A3B1E",
      "glow": "#A9C4C4",
      "spark": "#7F91B2",
      "velvet": "#3A1C10",
      "deep": "#0F0A08",
      "surface": "#1C1411",
      "text": "#EEE0D2",
      "muted": "#C0AA96",
      "ink": "#FCF2E8",
      "number2": "#D9895A",
      "bubbleUser": [
        "#9E5530",
        "#7A3B1E"
      ]
    },
    "day": {
      "primary": "#9E5530",
      "secondary": "#7A3B1E",
      "glow": "#3C7474",
      "spark": "#4F6B92",
      "wash": "#EED9CC",
      "page": "#F2EEEA",
      "surface": "#FFFAF6",
      "text": "#2F1D14",
      "muted": "#6F584A",
      "ink": "#FFF8F2",
      "bubbleUser": [
        "#CAA591",
        "#9BB3B1"
      ],
      "soft": {
        "page": "#E2DDD9",
        "surface": "#F5EFEB",
        "muted": "#523D32",
        "glow": "#375652"
      }
    }
  },
  {
    "id": "petrolbronze",
    "name": "Petrol & Bronze",
    "band": "Gold",
    "night": {
      "primary": "#7A6440",
      "secondary": "#3E5656",
      "glow": "#D08A5A",
      "spark": "#EBC06D",
      "velvet": "#253333",
      "deep": "#100F0D",
      "surface": "#1E1B18",
      "text": "#ECE1D7",
      "muted": "#C1A78E",
      "ink": "#FBF3EA",
      "number2": "#7A6440",
      "bubbleUser": [
        "#7A6440",
        "#3E5656"
      ]
    },
    "day": {
      "primary": "#93591C",
      "secondary": "#1F5C5C",
      "glow": "#9F592B",
      "spark": "#4F6496",
      "wash": "#DDE7E5",
      "page": "#E9F1F0",
      "surface": "#FAFCFB",
      "text": "#252B2B",
      "muted": "#5C625E",
      "ink": "#FFFCF5",
      "bubbleUser": [
        "#98B5B5",
        "#C0A88A"
      ],
      "soft": {
        "page": "#D9E1E0",
        "surface": "#EFF2F1",
        "muted": "#434947",
        "glow": "#74492B"
      }
    }
  },
  {
    "id": "honeysmoke",
    "name": "Honey & Smoke",
    "band": "Gold",
    "night": {
      "primary": "#C99A4E",
      "secondary": "#8A8A93",
      "glow": "#E6E6EA",
      "spark": "#8E3B46",
      "velvet": "#2A2A30",
      "deep": "#0E0E10",
      "surface": "#18181B",
      "text": "#E8E6E2",
      "muted": "#ADABA8",
      "ink": "#0E0E10",
      "number2": "#C99A4E",
      "bubbleUser": [
        "#8D6D3A",
        "#717179"
      ]
    },
    "day": {
      "primary": "#A2611A",
      "secondary": "#5C5C66",
      "glow": "#45454D",
      "spark": "#8E3B46",
      "wash": "#E6E6EA",
      "page": "#F4F0EA",
      "surface": "#FCFBFA",
      "text": "#26262B",
      "muted": "#5F5F66",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#C9A67E",
        "#B1AFB0"
      ],
      "soft": {
        "page": "#E4E0DB",
        "surface": "#F1F0F0",
        "muted": "#45454B",
        "glow": "#3A3A41"
      }
    }
  },
  {
    "id": "everforest",
    "name": "Everforest",
    "band": "Green",
    "night": {
      "primary": "#A7C080",
      "secondary": "#83C092",
      "glow": "#7FBBB3",
      "spark": "#C25B4E",
      "velvet": null,
      "deep": "#1A1F22",
      "surface": "#2D353B",
      "text": "#D3C6AA",
      "muted": "#9DA9A0",
      "ink": "#1A1F22",
      "number2": "#A7C080",
      "bubbleUser": [
        "#697957",
        "#557961"
      ]
    },
    "day": {
      "primary": "#577E2A",
      "secondary": "#2A8363",
      "glow": "#2D76A0",
      "spark": "#C85A50",
      "wash": "#E4EDDF",
      "page": "#F2F4EE",
      "surface": "#FBFCF8",
      "text": "#4A5860",
      "muted": "#627170",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#9BB280",
        "#8AB9A6"
      ],
      "soft": {
        "page": "#E5E8E3",
        "surface": "#F2F4F0",
        "muted": "#576669",
        "glow": "#376C8A"
      }
    }
  },
  {
    "id": "evergreen",
    "name": "Evergreen",
    "band": "Green",
    "night": {
      "primary": "#3C7050",
      "secondary": "#076678",
      "glow": "#83A598",
      "spark": "#D65D0E",
      "velvet": "#233524",
      "deep": "#0C100E",
      "surface": "#161C19",
      "text": "#EBDBB2",
      "muted": "#B4B9A8",
      "ink": "#FBF1C7",
      "number2": "#83A598",
      "bubbleUser": [
        "#3C7050",
        "#076678"
      ]
    },
    "day": {
      "primary": "#3C7050",
      "secondary": "#076678",
      "glow": "#4F7268",
      "spark": "#B4501E",
      "wash": "#DCE9E0",
      "page": "#EEF2EF",
      "surface": "#FAFCFA",
      "text": "#1C2A22",
      "muted": "#4F6156",
      "ink": "#FFFCF2",
      "bubbleUser": [
        "#99B4A3",
        "#88B4BB"
      ],
      "soft": {
        "page": "#DDE2DF",
        "surface": "#EFF1EF",
        "muted": "#38483F",
        "glow": "#3D5950"
      }
    }
  },
  {
    "id": "tidewater",
    "name": "Tidewater",
    "band": "Teal",
    "night": {
      "primary": "#2AA198",
      "secondary": "#268BD2",
      "glow": "#9DA3E3",
      "spark": "#CB4B16",
      "velvet": "#073642",
      "deep": "#001B23",
      "surface": "#002B36",
      "text": "#EEE8D5",
      "muted": "#AFBABA",
      "ink": "#00161D",
      "number2": "#2AA198",
      "bubbleUser": [
        "#20817C",
        "#2079B6"
      ]
    },
    "day": {
      "primary": "#1E7F78",
      "secondary": "#1F6FA8",
      "glow": "#5B5FB0",
      "spark": "#CB4B16",
      "wash": "#DDEDEE",
      "page": "#EFF4F3",
      "surface": "#FAFCFB",
      "text": "#073642",
      "muted": "#4F6970",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#82B7B3",
        "#8BB4CF"
      ],
      "soft": {
        "page": "#DCE5E5",
        "surface": "#EEF2F2",
        "muted": "#2F525B",
        "glow": "#3E518A"
      }
    }
  },
  {
    "id": "nord",
    "name": "Nord",
    "band": "Teal",
    "night": {
      "primary": "#88C0D0",
      "secondary": "#B48EAD",
      "glow": "#81A1C1",
      "spark": "#BF616A",
      "velvet": null,
      "deep": "#1C2028",
      "surface": "#2E3440",
      "text": "#ECEFF4",
      "muted": "#D8DEE9",
      "ink": "#1C2028",
      "number2": "#88C0D0",
      "bubbleUser": [
        "#587A86",
        "#836B82"
      ]
    },
    "day": {
      "primary": "#5677A0",
      "secondary": "#8C6A8A",
      "glow": "#4C6A8F",
      "spark": "#BF616A",
      "wash": "#E5E9F0",
      "page": "#ECEFF4",
      "surface": "#F8F9FB",
      "text": "#2E3440",
      "muted": "#4C566A",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#9EB1C8",
        "#B6A5B9"
      ],
      "soft": {
        "page": "#DDE0E6",
        "surface": "#EEEFF2",
        "muted": "#3E4757",
        "glow": "#425773"
      }
    }
  },
  {
    "id": "vague",
    "name": "Vague",
    "band": "Blue",
    "night": {
      "primary": "#6E94B2",
      "secondary": "#AEAED1",
      "glow": "#B4D4CF",
      "spark": "#E0A363",
      "velvet": "#405065",
      "deep": "#0E0E0F",
      "surface": "#1C1C24",
      "text": "#CDCDCD",
      "muted": "#A8A8B8",
      "ink": "#0E0E0F",
      "number2": "#6E94B2",
      "bubbleUser": [
        "#57748B",
        "#6E6E83"
      ]
    },
    "day": {
      "primary": "#4A6E8C",
      "secondary": "#6B6B9A",
      "glow": "#356A66",
      "spark": "#A8652A",
      "wash": "#E3E6EC",
      "page": "#EEEEF3",
      "surface": "#FBFBFC",
      "text": "#2A2A33",
      "muted": "#5E5E6E",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#AAAAC5",
        "#CAA78A"
      ],
      "soft": {
        "page": "#DEDEE4",
        "surface": "#F1F1F2",
        "muted": "#474753",
        "glow": "#315454"
      }
    }
  },
  {
    "id": "inkwell",
    "name": "Inkwell",
    "band": "Blue",
    "night": {
      "primary": "#24567F",
      "secondary": "#4D618E",
      "glow": "#B0B2F4",
      "spark": "#FC514E",
      "velvet": "#0E293F",
      "deep": "#010E1A",
      "surface": "#081E2F",
      "text": "#D6DEEB",
      "muted": "#A1AAB8",
      "ink": "#F2F6FB",
      "number2": "#87BCFF",
      "bubbleUser": [
        "#24567F",
        "#4D618E"
      ]
    },
    "day": {
      "primary": "#24567F",
      "secondary": "#4D618E",
      "glow": "#5A55B8",
      "spark": "#C2352F",
      "wash": "#DDE5F0",
      "page": "#F0EFEB",
      "surface": "#FAFBFD",
      "text": "#0E1F33",
      "muted": "#4A5A70",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#9EB2C0",
        "#AEABD5"
      ],
      "soft": {
        "page": "#DEDEDC",
        "surface": "#EEF0F3",
        "muted": "#2F3F55",
        "glow": "#3F4289"
      }
    }
  },
  {
    "id": "tokyonight",
    "name": "Tokyo Night",
    "band": "Blue",
    "night": {
      "primary": "#7AA2F7",
      "secondary": "#BB9AF7",
      "glow": "#7DCFFF",
      "spark": "#DB4B4B",
      "velvet": null,
      "deep": "#13141F",
      "surface": "#1F2335",
      "text": "#C0CAF5",
      "muted": "#A9B1D6",
      "ink": "#13141F",
      "number2": "#7AA2F7",
      "bubbleUser": [
        "#556FA9",
        "#7F6AA9"
      ]
    },
    "day": {
      "primary": "#2563C9",
      "secondary": "#7E3FD6",
      "glow": "#006D91",
      "spark": "#C64343",
      "wash": "#D5D6E1",
      "page": "#E1E2E7",
      "surface": "#F2F3F7",
      "text": "#2B4C9E",
      "muted": "#446499",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#96AFDB",
        "#B9A1E0"
      ],
      "soft": {
        "page": "#D2D6E1",
        "surface": "#E8EBF3",
        "muted": "#39599B",
        "glow": "#0F6196"
      }
    }
  },
  {
    "id": "amethyst",
    "name": "Amethyst",
    "band": "Violet",
    "night": {
      "primary": "#7A5CB8",
      "secondary": "#4D4F9A",
      "glow": "#89DDFF",
      "spark": "#BB9AF7",
      "velvet": "#2A1F4A",
      "deep": "#0F0D17",
      "surface": "#1A1726",
      "text": "#D9D6F0",
      "muted": "#ABA8C8",
      "ink": "#F4F1FF",
      "number2": "#B9A6EC",
      "bubbleUser": [
        "#7A5CB8",
        "#4D4F9A"
      ]
    },
    "day": {
      "primary": "#6A4BA8",
      "secondary": "#4D4F9A",
      "glow": "#1A7499",
      "spark": "#7E5CC8",
      "wash": "#E4DFF2",
      "page": "#F1EFF7",
      "surface": "#FBFAFE",
      "text": "#241B3A",
      "muted": "#5E5677",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#B6A7D4",
        "#A9A9CE"
      ],
      "soft": {
        "page": "#E1DEE8",
        "surface": "#F0EFF4",
        "muted": "#443B5C",
        "glow": "#1E5578"
      }
    }
  },
  {
    "id": "catppuccin",
    "name": "Mocha Mauve",
    "band": "Violet",
    "night": {
      "primary": "#CBA6F7",
      "secondary": "#F5C2E7",
      "glow": "#74C7EC",
      "spark": "#B4BEFE",
      "velvet": null,
      "deep": "#11111B",
      "surface": "#1E1E2E",
      "text": "#CDD6F4",
      "muted": "#A6ADC8",
      "ink": "#11111B",
      "number2": "#CBA6F7",
      "bubbleUser": [
        "#816A9F",
        "#7E667D"
      ]
    },
    "day": {
      "primary": "#8839EF",
      "secondary": "#5566D9",
      "glow": "#187889",
      "spark": "#7287FD",
      "wash": "#E6E1F5",
      "page": "#EFF1F5",
      "surface": "#F7F8FB",
      "text": "#4C4F69",
      "muted": "#686B82",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#C2A0F2",
        "#9FA9E6"
      ],
      "soft": {
        "page": "#E2E4EA",
        "surface": "#EEF0F4",
        "muted": "#5B5E77",
        "glow": "#2A6A7E"
      }
    }
  },
  {
    "id": "plum",
    "name": "Plum",
    "band": "Violet",
    "night": {
      "primary": "#5E2B66",
      "secondary": "#3B2556",
      "glow": "#B9C1D9",
      "spark": "#8E3B46",
      "velvet": "#241226",
      "deep": "#0E0910",
      "surface": "#1A121C",
      "text": "#EAE2EC",
      "muted": "#B8ADBC",
      "ink": "#F8F2FA",
      "number2": "#B79BD6",
      "bubbleUser": [
        "#5E2B66",
        "#3B2556"
      ]
    },
    "day": {
      "primary": "#5E2B66",
      "secondary": "#3B2556",
      "glow": "#4F5B85",
      "spark": "#8E3B46",
      "wash": "#E8DFEB",
      "page": "#F3EEF4",
      "surface": "#FDFBFD",
      "text": "#2A1830",
      "muted": "#6A5870",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#BDA8C1",
        "#B8AEC1"
      ],
      "soft": {
        "page": "#E3DDE4",
        "surface": "#F2F0F3",
        "muted": "#4D3B53",
        "glow": "#424467"
      }
    }
  },
  {
    "id": "rosepine",
    "name": "Rosé Pine",
    "band": "Rose",
    "night": {
      "primary": "#EB6F92",
      "secondary": "#C4A7E7",
      "glow": "#9CCFD8",
      "spark": "#31748F",
      "velvet": null,
      "deep": "#100E17",
      "surface": "#1F1D2E",
      "text": "#E0DEF4",
      "muted": "#908CAA",
      "ink": "#100E17",
      "number2": "#EB6F92",
      "bubbleUser": [
        "#AE5470",
        "#7C6A94"
      ]
    },
    "day": {
      "primary": "#A3536B",
      "secondary": "#7A6496",
      "glow": "#286983",
      "spark": "#56949F",
      "wash": "#F2E9E1",
      "page": "#FAF4ED",
      "surface": "#FFFAF3",
      "text": "#575279",
      "muted": "#6F6A92",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#CDA0A9",
        "#B7A9C0"
      ],
      "soft": {
        "page": "#EDE7E4",
        "surface": "#F7F2ED",
        "muted": "#645F87",
        "glow": "#386180"
      }
    }
  },
  {
    "id": "sky",
    "name": "Sky",
    "band": "Neutral",
    "night": {
      "primary": "#AEB6C2",
      "secondary": "#7C8798",
      "glow": "#E8823A",
      "spark": "#B48CFF",
      "velvet": "#2B3240",
      "deep": "#0D0F13",
      "surface": "#191C22",
      "text": "#E9ECF1",
      "muted": "#AEB4BF",
      "ink": "#0D0F13",
      "number2": "#AEB6C2",
      "bubbleUser": [
        "#6E737C",
        "#6A7483"
      ]
    },
    "day": {
      "primary": "#5D6878",
      "secondary": "#4A5466",
      "glow": "#9E4C10",
      "spark": "#7A52C7",
      "wash": "#E3E7EE",
      "page": "#EFEEF5",
      "surface": "#FAFBFC",
      "text": "#1E2430",
      "muted": "#5A6273",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#B7A3DF",
        "#D0A488"
      ],
      "soft": {
        "page": "#DEDEE5",
        "surface": "#EFF0F2",
        "muted": "#3F4655",
        "glow": "#713E1B"
      }
    }
  },
  {
    "id": "smoke",
    "name": "Smoke",
    "band": "Neutral",
    "night": {
      "primary": "#5F7389",
      "secondary": "#2E3E5C",
      "glow": "#DDE4EE",
      "spark": "#8FB0EE",
      "velvet": "#16213A",
      "deep": "#070809",
      "surface": "#121417",
      "text": "#E6E9EE",
      "muted": "#A7AFBA",
      "ink": "#F5F8FC",
      "number2": "#8FB0EE",
      "bubbleUser": [
        "#5F7389",
        "#2E3E5C"
      ]
    },
    "day": {
      "primary": "#3E4E63",
      "secondary": "#22304A",
      "glow": "#2B3A55",
      "spark": "#4D74C4",
      "wash": "#E1E5EC",
      "page": "#E8ECF2",
      "surface": "#F9F9FA",
      "text": "#14181F",
      "muted": "#545B66",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#9DAECB",
        "#97AEDA"
      ],
      "soft": {
        "page": "#D7DBE1",
        "surface": "#EEEEEF",
        "muted": "#373D46",
        "glow": "#232E42"
      }
    }
  },
  {
    "id": "obsidian",
    "name": "Obsidian",
    "band": "Neutral",
    "night": {
      "primary": "#4B5563",
      "secondary": "#1F2937",
      "glow": "#E5E7EB",
      "spark": "#9CA3AF",
      "velvet": "#111111",
      "deep": "#000000",
      "surface": "#0A0A0A",
      "text": "#F3F4F6",
      "muted": "#A3A8B0",
      "ink": "#F9FAFB",
      "number2": "#9CA3AF",
      "bubbleUser": [
        "#4B5563",
        "#1F2937"
      ]
    },
    "day": {
      "primary": "#2B2F36",
      "secondary": "#4B5563",
      "glow": "#111111",
      "spark": "#5F6672",
      "wash": "#F0F0F2",
      "page": "#FFFFFF",
      "surface": "#F7F7F8",
      "text": "#0A0A0A",
      "muted": "#52565E",
      "ink": "#FFFFFF",
      "bubbleUser": [
        "#AAACAF",
        "#A9ADB4"
      ],
      "soft": {
        "page": "#EBEBEB",
        "surface": "#EBEBEC",
        "muted": "#323438",
        "glow": "#0F0F0F"
      }
    }
  }
];
