/** Reviewed channel taxonomy port from LegacyLiveGroupDefinitions.php. These labels are distinct from news vocabulary. */
export const groupDefinitions: Record<string, {
    label: string;
    groups: {
        name: string;
        filters: Record<string, string>;
    }[];
}> = {
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
            },
            {
                "name": "台視",
                "filters": {
                    "tagid": "65",
                    "or": "1,13"
                }
            },
            {
                "name": "ETtoday",
                "filters": {
                    "tagid": "66",
                    "or": "1,13"
                }
            }
        ]
    },
    "media_all": {
        "label": "媒體",
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
                "name": "三立",
                "filters": {
                    "tagid": "64"
                }
            },
            {
                "name": "大紀元",
                "filters": {
                    "tagid": "55"
                }
            },
            {
                "name": "台視",
                "filters": {
                    "tagid": "65"
                }
            },
            {
                "name": "ETtoday",
                "filters": {
                    "tagid": "66"
                }
            },
            {
                "name": "華視",
                "filters": {
                    "tagid": "69"
                }
            },
            {
                "name": "自由時報",
                "filters": {
                    "tagid": "70"
                }
            },
            {
                "name": "年代",
                "filters": {
                    "tagid": "80"
                }
            },
            {
                "name": "公共電視",
                "filters": {
                    "tagid": "19"
                }
            },
            {
                "name": "中廣飛碟",
                "filters": {
                    "tagid": "75"
                }
            },
            {
                "name": "政經",
                "filters": {
                    "tagid": "71"
                }
            },
            {
                "name": "八大",
                "filters": {
                    "tagid": "72"
                }
            },
            {
                "name": "龍華環宇",
                "filters": {
                    "tagid": "73"
                }
            },
            {
                "name": "非凡",
                "filters": {
                    "tagid": "76"
                }
            },
            {
                "name": "鏡傳媒",
                "filters": {
                    "tagid": "77"
                }
            },
            {
                "name": "NOWnews",
                "filters": {
                    "tagid": "78"
                }
            },
            {
                "name": "緯來",
                "filters": {
                    "tagid": "84"
                }
            },
            {
                "name": "UDN",
                "filters": {
                    "tagid": "85"
                }
            },
            {
                "name": "麥卡貝",
                "filters": {
                    "tagid": "67"
                }
            },
            {
                "name": "STR Network",
                "filters": {
                    "tagid": "68"
                }
            },
            {
                "name": "關鍵評論網",
                "filters": {
                    "tagid": "18"
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
    },
    "two_all": {
        "label": "台灣／中國立場與其他頻道分類",
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
            },
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
                "name": "全部",
                "filters": {
                    "or": "1,2,13,14"
                }
            },
            {
                "name": "政治人物",
                "filters": {
                    "tagid": "2"
                }
            },
            {
                "name": "大外宣",
                "filters": {
                    "tagid": "15"
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
            },
            {
                "name": "中國政論",
                "filters": {
                    "tagid": "10"
                }
            },
            {
                "name": "異議份子",
                "filters": {
                    "tagid": "22"
                }
            }
        ]
    },
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
    }
};
