/** Exact embedded fallback from LegacyKeywordGroupDefinitions.php. File-driven all variants are not available. */
export const keywordGroupDefinitions:Record<string,{label:string;groups:{name:string;filters:Record<string,string>}[]}>= {
  "all": {
    "label": "全部",
    "groups": [
      {
        "name": "全部",
        "filters": {
          "or": "1,2,13,14"
        }
      }
    ]
  },
  "china": {
    "label": "中國影響",
    "groups": [
      {
        "name": "中國官方",
        "filters": {
          "tagid": "11"
        }
      },
      {
        "name": "大外宣",
        "filters": {
          "tagid": "15"
        }
      },
      {
        "name": "新大外宣",
        "filters": {
          "tagid": "90"
        }
      },
      {
        "name": "泛藍",
        "filters": {
          "tagid": "3"
        }
      },
      {
        "name": "泛紅",
        "filters": {
          "tagid": "5"
        }
      }
    ]
  },
  "media": {
    "label": "主要媒體",
    "groups": [
      {
        "name": "旺中",
        "filters": {
          "tagid": "53"
        }
      },
      {
        "name": "TVBS",
        "filters": {
          "tagid": "29"
        }
      },
      {
        "name": "三立",
        "filters": {
          "tagid": "64"
        }
      },
      {
        "name": "東森",
        "filters": {
          "tagid": "63"
        }
      },
      {
        "name": "民視",
        "filters": {
          "tagid": "50"
        }
      },
      {
        "name": "台視",
        "filters": {
          "tagid": "65"
        }
      },
      {
        "name": "年代",
        "filters": {
          "tagid": "80"
        }
      }
    ]
  },
  "media_social": {
    "label": "新聞與社論",
    "groups": [
      {
        "name": "旺中",
        "filters": {
          "tagid": "53",
          "or": "1,13"
        }
      },
      {
        "name": "TVBS",
        "filters": {
          "tagid": "29",
          "or": "1,13"
        }
      },
      {
        "name": "三立",
        "filters": {
          "tagid": "64",
          "or": "1,13"
        }
      },
      {
        "name": "東森",
        "filters": {
          "tagid": "63",
          "or": "1,13"
        }
      }
    ]
  },
  "politic": {
    "label": "社會觀察",
    "groups": [
      {
        "name": "全部",
        "filters": {
          "or": "1,2,13,14"
        }
      },
      {
        "name": "個人社論",
        "filters": {
          "tagid": "1",
          "not": "2,9,10,13"
        }
      },
      {
        "name": "新聞",
        "filters": {
          "tagid": "13"
        }
      },
      {
        "name": "台灣立場",
        "filters": {
          "tagid": "9,48"
        }
      },
      {
        "name": "中國立場",
        "filters": {
          "tagid": "9,49"
        }
      },
      {
        "name": "政治人物",
        "filters": {
          "tagid": "2"
        }
      }
    ]
  },
  "politician": {
    "label": "族群",
    "groups": [
      {
        "name": "新聞",
        "filters": {
          "tagid": "13"
        }
      },
      {
        "name": "個人社論",
        "filters": {
          "tagid": "1",
          "not": "2,9,10,13"
        }
      },
      {
        "name": "台灣立場",
        "filters": {
          "tagid": "9,48"
        }
      },
      {
        "name": "中國立場",
        "filters": {
          "tagid": "9,49"
        }
      }
    ]
  },
  "position": {
    "label": "政治立場",
    "groups": [
      {
        "name": "泛藍",
        "filters": {
          "tagid": "3"
        }
      },
      {
        "name": "泛白",
        "filters": {
          "tagid": "6"
        }
      },
      {
        "name": "泛綠",
        "filters": {
          "tagid": "4"
        }
      },
      {
        "name": "泛紅",
        "filters": {
          "tagid": "5"
        }
      }
    ]
  },
  "tv_position": {
    "label": "政論節目立場",
    "groups": [
      {
        "name": "台灣立場",
        "filters": {
          "tagid": "48"
        }
      },
      {
        "name": "中國立場",
        "filters": {
          "tagid": "49"
        }
      }
    ]
  },
  "two": {
    "label": "台灣立場 vs 中國立場",
    "groups": [
      {
        "name": "台灣立場",
        "filters": {
          "tagid": "9,48"
        }
      },
      {
        "name": "中國立場",
        "filters": {
          "tagid": "9,49"
        }
      }
    ]
  }
};
