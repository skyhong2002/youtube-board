/** Reviewed static definitions from LegacyGroupViewConfig.php; no PHP runtime dependency. */
export const legacyViews: Record<string, {
    name: string;
    tag_para: string;
}[]> = {
    "all": [
        {
            "name": "全部",
            "tag_para": "or=1,2,13,14"
        }
    ],
    "china": [
        {
            "name": "中國官方",
            "tag_para": "tagid=11"
        },
        {
            "name": "大外宣",
            "tag_para": "tagid=15"
        },
        {
            "name": "新大外宣",
            "tag_para": "tagid=90"
        },
        {
            "name": "泛藍",
            "tag_para": "tagid=3"
        },
        {
            "name": "泛紅",
            "tag_para": "tagid=5"
        }
    ],
    "media": [
        {
            "name": "旺中",
            "tag_para": "tagid=53"
        },
        {
            "name": "TVBS",
            "tag_para": "tagid=29"
        },
        {
            "name": "三立",
            "tag_para": "tagid=64"
        },
        {
            "name": "東森",
            "tag_para": "tagid=63"
        },
        {
            "name": "民視",
            "tag_para": "tagid=50"
        },
        {
            "name": "台視",
            "tag_para": "tagid=65"
        },
        {
            "name": "年代",
            "tag_para": "tagid=80"
        }
    ],
    "media_social": [
        {
            "name": "旺中",
            "tag_para": "tagid=53 or=1,13"
        },
        {
            "name": "TVBS",
            "tag_para": "tagid=29 or=1,13"
        },
        {
            "name": "三立",
            "tag_para": "tagid=64 or=1,13"
        },
        {
            "name": "東森",
            "tag_para": "tagid=63 or=1,13"
        }
    ],
    "people": [
        {
            "name": "全部",
            "tag_para": "or=1,2,13,14"
        },
        {
            "name": "新聞",
            "tag_para": "tagid=13"
        }
    ],
    "politic": [
        {
            "name": "全部",
            "tag_para": "or=1,2,13,14"
        },
        {
            "name": "個人社論",
            "tag_para": "tagid=1 not=2,9,10,13"
        },
        {
            "name": "新聞",
            "tag_para": "tagid=13"
        },
        {
            "name": "台灣立場",
            "tag_para": "tagid=9,48"
        },
        {
            "name": "中國立場",
            "tag_para": "tagid=9,49"
        },
        {
            "name": "政治人物",
            "tag_para": "tagid=2"
        }
    ],
    "politician": [
        {
            "name": "新聞",
            "tag_para": "tagid=13"
        },
        {
            "name": "個人社論",
            "tag_para": "tagid=1 not=2,9,10,13"
        },
        {
            "name": "台灣立場",
            "tag_para": "tagid=9,48"
        },
        {
            "name": "中國立場",
            "tag_para": "tagid=9,49"
        }
    ],
    "position": [
        {
            "name": "泛藍",
            "tag_para": "tagid=3"
        },
        {
            "name": "泛白",
            "tag_para": "tagid=6"
        },
        {
            "name": "泛綠",
            "tag_para": "tagid=4"
        },
        {
            "name": "泛紅",
            "tag_para": "tagid=5"
        }
    ],
    "tv_position": [
        {
            "name": "台灣立場",
            "tag_para": "tagid=48"
        },
        {
            "name": "中國立場",
            "tag_para": "tagid=49"
        }
    ],
    "two": [
        {
            "name": "台灣立場",
            "tag_para": "tagid=9,48"
        },
        {
            "name": "中國立場",
            "tag_para": "tagid=9,49"
        }
    ]
};
export const legacyTagSets: Record<string, string[]> = {
    "tags_coldwar": [
        "新冷戰",
        "環太軍演",
        "一帶一路",
        "第一島鏈",
        "G7",
        "北約",
        "金磚",
        "戰狼",
        "訪台",
        "裴洛西",
        "佩洛西",
        "華春瑩"
    ],
    "tags_country": [
        "中國",
        "大陸",
        "香港",
        "美國",
        "俄羅斯",
        "烏克蘭"
    ],
    "tags_covid": [
        "確診",
        "疫情",
        "快篩",
        "疫苗",
        "恩恩",
        "通報",
        "清零",
        "Novavax"
    ],
    "tags_economy": [
        "台積電",
        "聯發科",
        "通膨",
        "缺電",
        "電價",
        "特斯拉",
        "鴻海",
        "經濟衰退",
        "升息",
        "爛尾樓"
    ],
    "tags_elect": [
        "選舉",
        "候選人",
        "停電",
        "論文抄襲",
        "網軍",
        "通膨",
        "缺電"
    ],
    "tags_parties": [
        "國民黨",
        "民眾黨",
        "民進黨",
        "時代力量"
    ],
    "tags_president": [
        "蔡英文",
        "習近平",
        "岸田文雄",
        "拜登",
        "普丁",
        "馬克宏",
        "澤倫斯基",
        "莫迪"
    ],
    "tags_president2024": [
        "侯友宜",
        "柯文哲",
        "賴清德",
        "趙少康",
        "蕭美琴",
        "吳欣盈"
    ],
    "tags_straits": [
        "石斑魚",
        "軍演",
        "共軍",
        "航母",
        "解放軍",
        "台海",
        "兩岸",
        "兩岸統一",
        "王心凌",
        "台獨",
        "第一島鏈",
        "海峽中線",
        "一中政策",
        "一個中國",
        "訪台",
        "一中原則"
    ]
};
